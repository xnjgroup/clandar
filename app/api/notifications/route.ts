import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listGmailConnectors } from "@/lib/connectors";
import { BULK_TRASH_LABELS } from "@/lib/gmail-cleanup";
import { listNotifications, markNotificationsRead } from "@/lib/notifications";
import { bulkTrashJobId, bulkTrashStatus, type JobStatus } from "@/lib/queue";

export type RunningJob = { jobId: string; title: string; status: JobStatus };

/**
 * Bulk trashes still running for this org's Gmail accounts — shown with live
 * progress in the assistant's Updates. Only when a queue is configured
 * (REDIS_URL): without one there are no jobs, and an unreachable Redis would
 * otherwise hold this request open. Capped at 1.5s for the same reason.
 */
async function runningJobs(orgId: string): Promise<RunningJob[]> {
  if (!process.env.REDIS_URL) return [];
  const lookup = (async () => {
    const connectors = await listGmailConnectors(orgId);
    const checks = connectors.flatMap((c) =>
      BULK_TRASH_LABELS.map(async (l) => {
        const status = await bulkTrashStatus(c.id, l.id);
        if (!status || status.state === "completed" || status.state === "failed") return null;
        const account = connectors.length > 1 ? ` · ${c.accountLabel ?? c.name}` : "";
        return { jobId: bulkTrashJobId(c.id, l.id), title: `Trashing ${l.label.toLowerCase()}${account}`, status };
      }),
    );
    return (await Promise.all(checks)).filter((j): j is RunningJob => j !== null);
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
