/**
 * Runs once when the Next.js server starts. Brings up the BullMQ workers in
 * the same process — see `lib/gmail-cleanup-worker.ts` and
 * `lib/scheduled-tasks-worker.ts` for why they live here rather than a
 * separate script.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startGmailCleanupWorker } = await import("@/lib/gmail-cleanup-worker");
    startGmailCleanupWorker();

    const { startScheduledTasksWorker } = await import("@/lib/scheduled-tasks-worker");
    startScheduledTasksWorker();
    const { ensureTickScheduled } = await import("@/lib/scheduled-tasks-queue");
    await ensureTickScheduled();
  }
}
