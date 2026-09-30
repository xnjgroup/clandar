/**
 * The BullMQ worker that runs Gmail background jobs — inbox scans and bulk
 * trash. Started once from `instrumentation.ts` at server boot — inside the
 * same Next.js process, rather than a separate `node` script, specifically so
 * it can use the same `@/lib/...` imports as the rest of the app (a
 * standalone script run with plain `node` can't resolve that alias; Next's
 * own bundler is what makes it work here). Parked on `globalThis` for the
 * same reason as the Postgres pool and Redis connection: `next dev`
 * re-evaluates modules on edits, and without this a reload would start a
 * second worker listening on the same queue.
 *
 * Because it's only created once per process, editing this file (or
 * `lib/gmail-cleanup.ts`) needs a server restart to take effect — unlike
 * route/page code, the already-running `Worker`'s processor callback keeps
 * whatever closure it captured at startup.
 */
import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "@/lib/redis";
import { GMAIL_CLEANUP_QUEUE, type GmailWorkerJob } from "@/lib/queue";
import { BULK_TRASH_LABELS, runInboxScan, runTrashLabel } from "@/lib/gmail-cleanup";
import { getConnector } from "@/lib/connectors";
import { queryOne } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { pushToPerson } from "@/lib/push";

/**
 * Tells whoever started a bulk trash that it's finished (or failed) — a
 * notification in the assistant's Updates (badging its button) plus a push.
 * Older jobs without `requestedBy` go to whoever connected the account.
 */
async function notifyTrashDone(
  connectorId: string,
  label: string,
  requestedBy: string | undefined,
  result: { trashed: number } | { error: string },
) {
  try {
    const connector = await getConnector(connectorId);
    const personId =
      requestedBy ??
      (await queryOne<{ created_by: string | null }>(`SELECT created_by FROM connectors WHERE id = $1`, [connectorId]))
        ?.created_by ??
      null;
    if (!connector || !personId) return;
    const name = (BULK_TRASH_LABELS.find((l) => l.id === label)?.label ?? label).toLowerCase();
    const account = connector.accountLabel ?? connector.name;
    const title =
      "error" in result
        ? `Trashing ${name} stopped`
        : `Trashed ${result.trashed.toLocaleString("en-US")} ${name} email${result.trashed === 1 ? "" : "s"}`;
    const body =
      "error" in result
        ? `${account}: ${result.error}`
        : `${account} — they're in Gmail's Trash for 30 days if you need anything back.`;
    const link = `/email?account=${connectorId}`;
    await createNotification({ orgId: connector.orgId, personId, title, body, link }).catch(() => {});
    await pushToPerson(personId, { title, body, link }).catch(() => {});
  } catch {
    // Never let a notification problem fail the job itself.
  }
}

const globalForWorker = globalThis as typeof globalThis & { clandarGmailWorker?: Worker };

export function startGmailCleanupWorker() {
  if (globalForWorker.clandarGmailWorker) return globalForWorker.clandarGmailWorker;

  const worker = new Worker<GmailWorkerJob>(
    GMAIL_CLEANUP_QUEUE,
    async (job: Job<GmailWorkerJob>) => {
      // Uniform shape ({ done, total }) regardless of job kind — the SSE
      // endpoint and its client component don't need to know which this is.
      const onProgress = (done: number, total: number) => job.updateProgress({ done, total });
      if (job.data.kind === "analyze-inbox") {
        await runInboxScan(job.data.connectorId, job.data.maxMessages, job.data.label, job.id, onProgress);
      } else {
        const { connectorId, label, requestedBy } = job.data;
        try {
          const { trashed } = await runTrashLabel(connectorId, label, onProgress);
          await notifyTrashDone(connectorId, label, requestedBy, { trashed });
        } catch (error) {
          await notifyTrashDone(connectorId, label, requestedBy, {
            error: error instanceof Error ? error.message : "Unknown error",
          });
          throw error;
        }
      }
    },
    // Its own connection, not the shared one `redis()` hands out — a Worker
    // holds a connection open for blocking reads, and BullMQ recommends it not
    // share that with other traffic (the Queue producer, QueueEvents).
    { connection: createRedisConnection(), concurrency: 1 },
  );

  worker.on("failed", (job, error) => {
    console.error(`[gmail-cleanup] ${job?.data.kind} failed for connector ${job?.data.connectorId}:`, error);
  });
  worker.on("ready", () => console.log("[gmail-cleanup] worker ready"));

  globalForWorker.clandarGmailWorker = worker;
  return worker;
}
