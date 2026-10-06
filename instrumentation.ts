/**
 * Runs once when the Next.js server starts. In a long-running server (`next dev`, `next start`) it
 * starts a job runner in-process (lib/job-runner.ts) so background jobs and the minute tick run with
 * nothing else to start. Not on Vercel — serverless instances don't stay up; there, `npm run runner`
 * on any machine and the /api/cron/tick cron do the work. RUNNER=off turns it off anywhere.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL || process.env.RUNNER === "off") return;
  const { startRunner } = await import("@/lib/job-runner");
  startRunner({ name: process.env.RUNNER_NAME || "dev-server" });
}
