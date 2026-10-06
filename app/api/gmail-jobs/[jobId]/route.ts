import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getConnectorForOrg } from "@/lib/connectors";
import { jobConnectorId, jobStatus, setJobControl, type JobStatus } from "@/lib/queue";

/** Only jobs on the viewer's own org's Gmail accounts. */
async function ownsJob(jobId: string): Promise<boolean> {
  const { org } = await requireSession();
  const connectorId = await jobConnectorId(jobId);
  return Boolean(connectorId && (await getConnectorForOrg(connectorId, org.id)));
}

/** POST { action: "pause" | "resume" | "cancel" } → controls a running bulk trash (the worker picks it up before its next message). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!(await ownsJob(jobId))) return Response.json({ error: "Not found" }, { status: 404 });
  const { action } = (await request.json().catch(() => ({}))) as { action?: string };
  if (action !== "pause" && action !== "resume" && action !== "cancel") {
    return Response.json({ error: "action must be pause, resume or cancel" }, { status: 400 });
  }
  await setJobControl(jobId, action === "resume" ? null : action);
  return Response.json({ ok: true });
}

export const dynamic = "force-dynamic";
// Long enough for a scan or bulk trash; the browser reconnects if it's cut off.
export const maxDuration = 300;

/**
 * Server-Sent Events for one job's progress — an inbox scan or a bulk trash, both `{ done, total }`.
 * Reads the job row once a second and pushes only changes; the browser's small progress component
 * is all that re-renders.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!(await ownsJob(jobId))) return new Response("Not found", { status: 404 });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (data: JobStatus | { done: true }) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const finish = () => {
        if (closed) return;
        send({ done: true });
        closed = true;
        controller.close();
      };
      request.signal.addEventListener("abort", finish);
      let lastSent = "";
      const started = Date.now();
      while (!closed && Date.now() - started < 290_000) {
        const status = await jobStatus(jobId).catch(() => null);
        if (!status) break;
        const key = JSON.stringify(status);
        if (key !== lastSent) {
          send(status);
          lastSent = key;
        }
        if (status.state === "completed" || status.state === "failed") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      finish();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
