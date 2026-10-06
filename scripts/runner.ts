/**
 * A Clandar job runner — `npm run runner` on any machine with the app's env (.env.local or real
 * environment variables: DATABASE_URL, the Google / encryption / AI keys the jobs need). It claims
 * background jobs (Gmail scans and bulk trash, scheduled automations) from the shared Postgres queue
 * and does the minute tick, like a GitHub Actions runner. Start as many as you like.
 *
 *   RUNNER_NAME=my-mac npm run runner              # every kind of job
 *   RUNNER_KINDS=trash-label,trash-search npm run runner
 *   RUNNER_CONCURRENCY=3 npm run runner
 */
import { startRunner } from "@/lib/job-runner";

const runner = startRunner({
  name: process.env.RUNNER_NAME,
  kinds: process.env.RUNNER_KINDS?.split(",").map((k) => k.trim()).filter(Boolean),
  concurrency: Number(process.env.RUNNER_CONCURRENCY) || 2,
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log("[runner] finishing current jobs… (press again to quit now)");
    void runner.stop().then(() => process.exit(0));
  });
}
