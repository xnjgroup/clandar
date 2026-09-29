/**
 * Runs once when the Next.js server starts. Its one job here is bringing up
 * the Gmail cleanup BullMQ worker in the same process — see
 * `lib/gmail-cleanup-worker.ts` for why it lives here rather than a separate
 * script.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startGmailCleanupWorker } = await import("@/lib/gmail-cleanup-worker");
    startGmailCleanupWorker();
  }
}
