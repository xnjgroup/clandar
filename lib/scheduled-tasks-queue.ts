/**
 * The BullMQ queue behind scheduled AI tasks. A repeatable "tick" job (see
 * `ensureTickScheduled`) runs every 5 minutes and enqueues a "run" job for
 * each task whose `next_run_at` has arrived — the worker
 * (lib/scheduled-tasks-worker.ts), started from `instrumentation.ts`, does
 * the actual work.
 */
import { Queue } from "bullmq";
import { redis } from "@/lib/redis";

export const SCHEDULED_TASKS_QUEUE = "scheduled-tasks";
const TICK_INTERVAL_MS = 5 * 60 * 1000;

export type SchedulerJob = { kind: "tick" } | { kind: "run"; taskId: string; orgId: string };

const globalForQueue = globalThis as typeof globalThis & {
  clandarScheduledTasksQueue?: Queue<SchedulerJob>;
};

export function scheduledTasksQueue(): Queue<SchedulerJob> {
  if (!globalForQueue.clandarScheduledTasksQueue) {
    globalForQueue.clandarScheduledTasksQueue = new Queue<SchedulerJob>(SCHEDULED_TASKS_QUEUE, {
      connection: redis(),
      defaultJobOptions: {
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return globalForQueue.clandarScheduledTasksQueue;
}

/** Idempotent — safe to call every time the server starts (instrumentation.ts does). */
export async function ensureTickScheduled(): Promise<void> {
  await scheduledTasksQueue().upsertJobScheduler(
    "scheduled-tasks-tick",
    { every: TICK_INTERVAL_MS },
    { name: "tick", data: { kind: "tick" } },
  );
}

/** Runs a task immediately (the "Run now" button) rather than waiting for its schedule. */
export async function enqueueRunNow(taskId: string, orgId: string): Promise<void> {
  await scheduledTasksQueue().add("run", { kind: "run", taskId, orgId });
}
