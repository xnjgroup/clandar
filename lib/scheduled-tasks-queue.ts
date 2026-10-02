/**
 * The BullMQ queue behind scheduled AI tasks. A repeatable "tick" job (see
 * `ensureTickScheduled`) runs every 5 minutes and enqueues a "run" job for
 * each task whose `next_run_at` has arrived — the worker
 * (lib/scheduled-tasks-worker.ts), started from `instrumentation.ts`, does
 * the actual work.
 */
import { Queue } from "bullmq";
import { logRedisError, redis, withRedis } from "@/lib/redis";

export const SCHEDULED_TASKS_QUEUE = "scheduled-tasks";
const TICK_INTERVAL_MS = 5 * 60 * 1000;

/** `manual`: "Run now" — runs whenever it's asked, without taking the schedule's next slot. */
export type SchedulerJob = { kind: "tick" } | { kind: "run"; taskId: string; orgId: string; manual?: boolean };

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
    globalForQueue.clandarScheduledTasksQueue.on("error", (error) => logRedisError("scheduled-tasks queue", error));
  }
  return globalForQueue.clandarScheduledTasksQueue;
}

/**
 * Idempotent — called every time the server starts (instrumentation.ts), without awaiting: while
 * Redis is unreachable it keeps retrying in the background (every 30s) and never holds up startup.
 */
export function ensureTickScheduled(): void {
  const attempt = () =>
    withRedis(() =>
      scheduledTasksQueue().upsertJobScheduler(
        "scheduled-tasks-tick",
        { every: TICK_INTERVAL_MS },
        { name: "tick", data: { kind: "tick" } },
      ),
    ).catch((error: unknown) => {
      logRedisError("scheduling the 5-minute tick", error);
      setTimeout(attempt, 30_000).unref?.();
    });
  void attempt();
}

/** Runs a task immediately (the "Run now" button) rather than waiting for its schedule. */
export async function enqueueRunNow(taskId: string, orgId: string): Promise<void> {
  await withRedis(() => scheduledTasksQueue().add("run", { kind: "run", taskId, orgId, manual: true }));
}
