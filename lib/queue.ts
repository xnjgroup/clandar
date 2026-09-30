/**
 * The BullMQ queue behind Gmail background work. Server actions enqueue jobs
 * here; the worker started from `instrumentation.ts` (see
 * `lib/gmail-cleanup-worker.ts`) is what actually runs them, in the same
 * process. A scan's results land in Postgres (`cleanup_scans`/
 * `cleanup_candidates`); a job's live progress (both kinds report the same
 * `{ done, total }` shape via `job.updateProgress`) is read back through
 * `jobStatus`, and pushed to the browser over SSE by
 * `app/api/gmail-jobs/[jobId]/route.ts` — no client-side polling.
 */
import { Queue, QueueEvents } from "bullmq";
import { createRedisConnection, redis } from "@/lib/redis";

export const GMAIL_CLEANUP_QUEUE = "gmail-cleanup";

export type AnalyzeInboxJob = {
  kind: "analyze-inbox";
  connectorId: string;
  /** Cap how many messages one run scans — a full inbox can be six figures. */
  maxMessages: number;
  /** One of `SCAN_LABELS`' ids to scope the scan to, or null for the whole inbox. */
  label: string | null;
};

export type TrashLabelJob = {
  kind: "trash-label";
  connectorId: string;
  /** One of `BULK_TRASH_LABELS`' ids — everything in it gets trashed, no review. */
  label: string;
  /** Who started it — told (notification + push) when it finishes. */
  requestedBy?: string;
};

export type GmailWorkerJob = AnalyzeInboxJob | TrashLabelJob;

const globalForQueue = globalThis as typeof globalThis & {
  clandarGmailQueue?: Queue<GmailWorkerJob>;
  clandarGmailQueueEvents?: QueueEvents;
};

export function gmailCleanupQueue(): Queue<GmailWorkerJob> {
  if (!globalForQueue.clandarGmailQueue) {
    globalForQueue.clandarGmailQueue = new Queue<GmailWorkerJob>(GMAIL_CLEANUP_QUEUE, {
      connection: redis(),
      defaultJobOptions: {
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 20 },
      },
    });
  }
  return globalForQueue.clandarGmailQueue;
}

/**
 * A dedicated connection, per BullMQ's own recommendation — `QueueEvents`
 * holds it open for a blocking read of Redis's event stream, and sharing that
 * with the `Queue` producer's traffic risks one starving the other.
 */
export function gmailQueueEvents(): QueueEvents {
  if (!globalForQueue.clandarGmailQueueEvents) {
    globalForQueue.clandarGmailQueueEvents = new QueueEvents(GMAIL_CLEANUP_QUEUE, {
      connection: createRedisConnection(),
    });
  }
  return globalForQueue.clandarGmailQueueEvents;
}

export async function enqueueInboxAnalysis(
  connectorId: string,
  maxMessages = 2_000,
  label: string | null = null,
) {
  return gmailCleanupQueue().add("analyze-inbox", { kind: "analyze-inbox", connectorId, maxMessages, label });
}

/** No colons — BullMQ uses `:` as its own Redis key delimiter and rejects a custom job id containing one. */
export function bulkTrashJobId(connectorId: string, label: string) {
  return `trash-label-${label}-${connectorId}`;
}

/**
 * Enqueues a bulk trash for one label, keyed so a second click while one is
 * already running just returns the same in-flight job rather than starting a
 * duplicate. Unlike a fresh id every time, reusing one this way means a
 * finished job has to be explicitly cleared first — BullMQ refuses to re-add
 * a job whose id already exists in a terminal (completed/failed) state.
 */
export async function enqueueTrashLabel(connectorId: string, label: string, requestedBy?: string) {
  const queueRef = gmailCleanupQueue();
  const jobId = bulkTrashJobId(connectorId, label);
  const existing = await queueRef.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state !== "completed" && state !== "failed") return existing;
    await existing.remove();
  }
  await setJobControl(jobId, null);
  return queueRef.add("trash-label", { kind: "trash-label", connectorId, label, requestedBy }, { jobId });
}

export type JobStatus = {
  state: "waiting" | "active" | "completed" | "failed" | string;
  done: number;
  total: number;
  error: string | null;
  /** A bulk trash the person paused (it resumes where it stopped). */
  paused?: boolean;
};

/**
 * Pause / cancel for a running bulk trash. BullMQ can't pause one job, so it's
 * a flag in Redis the worker checks before each message (lib/gmail-cleanup-worker.ts):
 * "pause" holds it where it is, "cancel" stops it, no flag carries on.
 */
export type JobControl = "pause" | "cancel";
const controlKey = (jobId: string) => `clandar:job-control:${jobId}`;

export async function setJobControl(jobId: string, control: JobControl | null): Promise<void> {
  if (control) await redis().set(controlKey(jobId), control, "EX", 86_400);
  else await redis().del(controlKey(jobId));
}

export async function getJobControl(jobId: string): Promise<JobControl | null> {
  const value = await redis().get(controlKey(jobId));
  return value === "pause" || value === "cancel" ? value : null;
}

/** A job's current state and progress by its raw BullMQ id — what the SSE route sends on first connect, and what a page reads for its initial server-rendered paint. */
export async function jobStatus(jobId: string): Promise<JobStatus | null> {
  const job = await gmailCleanupQueue().getJob(jobId);
  if (!job) return null;
  const state = await job.getState();
  const progress = job.progress as { done: number; total: number; paused?: boolean } | undefined;
  return {
    state,
    done: progress?.done ?? 0,
    total: progress?.total ?? 0,
    error: state === "failed" ? (job.failedReason ?? "Unknown error") : null,
    paused: progress?.paused ?? false,
  };
}

/** Which connector a job belongs to — so the progress stream can check it's the viewer's org's. */
export async function jobConnectorId(jobId: string): Promise<string | null> {
  const job = await gmailCleanupQueue().getJob(jobId);
  return job?.data.connectorId ?? null;
}

/** `jobStatus`, addressed by connector + label instead of a raw job id — for the trash progress panel. */
export async function bulkTrashStatus(connectorId: string, label: string): Promise<JobStatus | null> {
  return jobStatus(bulkTrashJobId(connectorId, label));
}
