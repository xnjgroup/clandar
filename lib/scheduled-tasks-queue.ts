/**
 * Scheduled AI tasks on the job queue: the runners' minute tick (lib/job-runner.ts) queues each due
 * run; "Run now" queues one straight away.
 */
import { enqueueJob } from "@/lib/jobs";

/** Runs a task immediately (the "Run now" button) rather than waiting for its schedule. */
export async function enqueueRunNow(taskId: string, orgId: string): Promise<void> {
  await enqueueJob({ kind: "scheduled-run", orgId, payload: { taskId, orgId, manual: true }, maxAttempts: 1 });
}
