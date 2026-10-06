import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listGmailConnectors } from "@/lib/connectors";
import { BULK_TRASH_LABELS } from "@/lib/gmail-cleanup";
import { deleteNotifications, listNotifications, markNotificationsRead } from "@/lib/notifications";
import { jobStatus, runningTrashJobs, type JobStatus } from "@/lib/queue";

export type RunningJob = { jobId: string; title: string; status: JobStatus };

/**
 * Bulk trashes still running for this org's Gmail accounts — shown with live
 * progress in the assistant's Updates. Capped at 1.5s so a slow database never
 * holds this request open.
 */
async function runningJobs(orgId: string): Promise<RunningJob[]> {
  const lookup = (async () => {
    const connectors = await listGmailConnectors(orgId);
    const byId = new Map(connectors.map((c) => [c.id, c]));
    const jobs = (await runningTrashJobs()).filter((j) => byId.has(j.connectorId));
    const found = await Promise.all(
      jobs.map(async (job) => {
        const status = await jobStatus(job.jobId);
        if (!status || status.state === "completed" || status.state === "failed") return null;
        const c = byId.get(job.connectorId)!;
        const account = connectors.length > 1 ? ` · ${c.accountLabel ?? c.name}` : "";
        const what =
          job.kind === "trash-label"
            ? (BULK_TRASH_LABELS.find((l) => l.id === job.label)?.label ?? job.label).toLowerCase()
            : `“${job.query}”`;
        return { jobId: job.jobId, title: `Trashing ${what}${account}`, status };
      }),
    );
    return found.filter((j): j is RunningJob => j !== null);
  })();
  const timeout = new Promise<RunningJob[]>((resolve) => setTimeout(() => resolve([]), 1500));
  return Promise.race([lookup.catch(() => []), timeout]);
}

/** GET → the signed-in person's latest notifications + unread count, and any running bulk trash (the assistant polls this). */
export async function GET() {
  const { org, person } = await requireSession();
  const [notifications, jobs] = await Promise.all([listNotifications(person.id), runningJobs(org.id)]);
  return NextResponse.json({ ...notifications, jobs });
}

/** POST { id? } → marks one notification read, or all of them without an id. */
export async function POST(request: Request) {
  const { person } = await requireSession();
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  await markNotificationsRead(person.id, typeof body.id === "string" ? body.id : undefined);
  return NextResponse.json({ ok: true });
}

/** DELETE { id? } → dismisses one notification, or clears them all without an id. */
export async function DELETE(request: Request) {
  const { person } = await requireSession();
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  await deleteNotifications(person.id, typeof body.id === "string" ? body.id : undefined);
  return NextResponse.json({ ok: true });
}
