/**
 * The worker behind scheduled AI tasks — started once from
 * `instrumentation.ts`, alongside the Gmail cleanup worker. A "tick" job
 * (repeating every 5 minutes, see lib/scheduled-tasks-queue.ts) fans out into
 * one "run" job per due task; each "run" job calls `executeScheduledTask`.
 */
import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "@/lib/redis";
import { SCHEDULED_TASKS_QUEUE, scheduledTasksQueue, type SchedulerJob } from "@/lib/scheduled-tasks-queue";
import { dueScheduledTasks, executeScheduledTask } from "@/lib/scheduled-tasks";
import { runLeadDigests, runLeadFinder } from "@/lib/lead-finder";
import { fireDueReminders } from "@/lib/reminders";

const globalForWorker = globalThis as typeof globalThis & { clandarScheduledTasksWorker?: Worker };

export function startScheduledTasksWorker() {
  if (globalForWorker.clandarScheduledTasksWorker) return globalForWorker.clandarScheduledTasksWorker;

  const worker = new Worker<SchedulerJob>(
    SCHEDULED_TASKS_QUEUE,
    async (job: Job<SchedulerJob>) => {
      if (job.data.kind === "tick") {
        // Due reminders ride the same 5-minute tick (lib/reminders.ts); a failure there mustn't stop scheduled tasks.
        await fireDueReminders().catch((error: unknown) =>
          console.error("[reminders] failed:", error instanceof Error ? error.message : error),
        );
        // Lead finder scans (each org on its own 15/30/60-minute cadence) and the daily lead digests.
        await runLeadFinder().catch((error: unknown) =>
          console.error("[lead-finder] failed:", error instanceof Error ? error.message : error),
        );
        await runLeadDigests().catch((error: unknown) =>
          console.error("[lead-digest] failed:", error instanceof Error ? error.message : error),
        );
        const due = await dueScheduledTasks();
        for (const task of due) {
          await scheduledTasksQueue().add("run", { kind: "run", taskId: task.id, orgId: task.orgId });
        }
        return;
      }
      await executeScheduledTask(job.data.taskId, job.data.orgId);
    },
    { connection: createRedisConnection(), concurrency: 2 },
  );

  worker.on("failed", (job, error) => console.error(`[scheduled-tasks] job ${job?.id} failed:`, error.message));
  worker.on("ready", () => console.log("[scheduled-tasks] worker ready"));

  globalForWorker.clandarScheduledTasksWorker = worker;
  return worker;
}
