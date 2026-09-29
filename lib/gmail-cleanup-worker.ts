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
import { runInboxScan, runTrashLabel } from "@/lib/gmail-cleanup";

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
        await runTrashLabel(job.data.connectorId, job.data.label, onProgress);
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
