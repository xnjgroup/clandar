import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getConnectorForOrg } from "@/lib/connectors";
import { gmailQueueEvents, jobConnectorId, jobStatus, type JobStatus } from "@/lib/queue";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events for one BullMQ job's progress — an inbox scan or a bulk
 * trash, both reporting the same `{ done, total }` shape. Replaces polling
 * with `router.refresh()`: that re-rendered the whole route on an interval,
 * which is what made the page feel like it was constantly "Rendering" and
 * left nothing clickable while a job ran. This only pushes an update when
 * BullMQ actually has one, and only the progress bar's own small client
 * component re-renders — the rest of the page is untouched.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  // Only for jobs on the viewer's own org's Gmail accounts.
  const { org } = await requireSession();
  const connectorId = await jobConnectorId(jobId);
  if (!connectorId || !(await getConnectorForOrg(connectorId, org.id))) {
    return new Response("Not found", { status: 404 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (data: JobStatus | { done: true }) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const events = gmailQueueEvents();

      const onProgress = (args: { jobId: string; data: unknown }) => {
        if (args.jobId !== jobId) return;
        const data = args.data as { done: number; total: number };
        send({ state: "active", done: data.done ?? 0, total: data.total ?? 0, error: null });
      };
      const onCompleted = (args: { jobId: string }) => {
        if (args.jobId !== jobId) return;
        send({ state: "completed", done: 0, total: 0, error: null });
        finish();
      };
      const onFailed = (args: { jobId: string; failedReason: string }) => {
        if (args.jobId !== jobId) return;
        send({ state: "failed", done: 0, total: 0, error: args.failedReason });
        finish();
      };

      function finish() {
        if (closed) return;
        events.off("progress", onProgress);
        events.off("completed", onCompleted);
        events.off("failed", onFailed);
        send({ done: true }); // must run before `closed = true` — send() itself no-ops once closed
        closed = true;
        controller.close();
      }

      // The state as of right now, so a client connecting mid-run (or after
      // it already finished) isn't left waiting for an event that already
      // happened before it subscribed.
      const initial = await jobStatus(jobId);
      if (!initial || initial.state === "completed" || initial.state === "failed") {
        if (initial) send(initial);
        finish();
        return;
      }
      send(initial);

      events.on("progress", onProgress);
      events.on("completed", onCompleted);
      events.on("failed", onFailed);

      request.signal.addEventListener("abort", finish);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
