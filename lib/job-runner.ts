/**
 * A job runner: claims background jobs from the Postgres queue (lib/jobs.ts) and runs them, and — once
 * a minute, shared with every other runner and the cron — does the tick: due reminders, lead finder
 * scans and digests, and queueing scheduled automation runs.
 *
 * Where it runs:
 *  - `npm run runner` on any machine with the app's env (your Mac, a small always-on box) — the
 *    GitHub-runner model: start as many as you like, they share the queue safely;
 *  - inside `next dev` / a long-running `next start` (instrumentation.ts), unless RUNNER=off;
 *  - on Vercel, /api/cron/tick runs the tick and short jobs within one request, so reminders and
 *    automations still fire when no runner is online.
 */
import { hostname } from "node:os";
import { BULK_TRASH_LABELS, runInboxScan, runTrashLabel, runTrashSearch } from "@/lib/gmail-cleanup";
import { getConnector } from "@/lib/connectors";
import { query, queryOne } from "@/lib/db";
import { claimJob, claimTick, enqueueJob, finishJob, heartbeatJob, pruneJobs, runnerHeartbeat, type BackgroundJob } from "@/lib/jobs";
import { runLeadDigests, runLeadFinder } from "@/lib/lead-finder";
import { createNotification } from "@/lib/notifications";
import { pushToPerson } from "@/lib/push";
import { fireDueReminders } from "@/lib/reminders";
import { executeScheduledTask } from "@/lib/scheduled-tasks";

/** Kinds short enough to run inside a cron request on Vercel; the rest wait for a runner. */
export const SHORT_JOB_KINDS = ["scheduled-run"];

type Context = {
  /** Records progress ({ done, total }); throttled. */
  progress: (done: number, total: number) => Promise<void>;
  /** Before each unit of work: "cancel" to stop; waits here while paused. */
  checkpoint: (done: number, total: number) => Promise<"continue" | "cancel">;
};

/* ── What each kind of job does ─────────────────────────────── */

/** Tells whoever started a bulk trash that it finished (or failed): a notification and a push. */
async function notifyTrashDone(
  connectorId: string,
  what: string,
  requestedBy: string | undefined,
  result: { trashed: number; cancelled?: boolean } | { error: string },
) {
  try {
    const connector = await getConnector(connectorId);
    const personId =
      requestedBy ??
      (await queryOne<{ created_by: string | null }>(`SELECT created_by FROM connectors WHERE id = $1`, [connectorId]))?.created_by ??
      null;
    if (!connector || !personId) return;
    const account = connector.accountLabel ?? connector.name;
    const isSearch = what.startsWith("emails matching");
    const n = "error" in result ? 0 : result.trashed;
    const count = isSearch
      ? `${n.toLocaleString("en-US")} ${what.replace(/^emails/, n === 1 ? "email" : "emails")}`
      : `${n.toLocaleString("en-US")} ${what} email${n === 1 ? "" : "s"}`;
    const title = "error" in result ? `Trashing ${what} stopped` : result.cancelled ? `Stopped trashing ${what}` : `Trashed ${count}`;
    const body =
      "error" in result
        ? `${account}: ${result.error}`
        : result.cancelled
          ? `${account} — you cancelled it after ${count} went to Trash (kept there for 30 days).`
          : `${account} — they're in Gmail's Trash for 30 days if you need anything back.`;
    const link = `/email?account=${connectorId}`;
    await createNotification({ orgId: connector.orgId, personId, title, body, link }).catch(() => {});
    await pushToPerson(personId, { title, body, link }).catch(() => {});
  } catch {
    // A notification problem never fails the job.
  }
}

const HANDLERS: Record<string, (job: BackgroundJob, ctx: Context) => Promise<{ cancelled?: boolean } | void>> = {
  "analyze-inbox": async (job, ctx) => {
    const p = job.payload as { connectorId: string; maxMessages: number; label: string | null };
    await runInboxScan(p.connectorId, p.maxMessages, p.label, job.id, (done, total) => ctx.progress(done, total));
  },
  "trash-label": async (job, ctx) => {
    const p = job.payload as { connectorId: string; label: string; requestedBy?: string };
    const what = (BULK_TRASH_LABELS.find((l) => l.id === p.label)?.label ?? p.label).toLowerCase();
    try {
      const { trashed, cancelled } = await runTrashLabel(p.connectorId, p.label, (d, t) => ctx.progress(d, t), ctx.checkpoint);
      await notifyTrashDone(p.connectorId, what, p.requestedBy, cancelled ? { trashed, cancelled } : { trashed });
      return { cancelled };
    } catch (error) {
      await notifyTrashDone(p.connectorId, what, p.requestedBy, { error: error instanceof Error ? error.message : "Unknown error" });
      throw error;
    }
  },
  "trash-search": async (job, ctx) => {
    const p = job.payload as { connectorId: string; query: string; requestedBy?: string };
    const what = `emails matching “${p.query}”`;
    try {
      const { trashed, cancelled } = await runTrashSearch(p.connectorId, p.query, (d, t) => ctx.progress(d, t), ctx.checkpoint);
      await notifyTrashDone(p.connectorId, what, p.requestedBy, cancelled ? { trashed, cancelled } : { trashed });
      return { cancelled };
    } catch (error) {
      await notifyTrashDone(p.connectorId, what, p.requestedBy, { error: error instanceof Error ? error.message : "Unknown error" });
      throw error;
    }
  },
  "scheduled-run": async (job) => {
    const p = job.payload as { taskId: string; orgId: string; manual?: boolean };
    await executeScheduledTask(p.taskId, p.orgId, { manual: p.manual ?? false });
  },
};

export const JOB_KINDS = Object.keys(HANDLERS);

/** Runs one claimed job to the end: lease renewed every 30 s, progress throttled, pause / cancel honoured. */
async function runJob(job: BackgroundJob, runnerId: string): Promise<void> {
  const handler = HANDLERS[job.kind];
  if (!handler) {
    await finishJob(job.id, runnerId, { error: `No handler for "${job.kind}".` }, false);
    return;
  }
  let last = { done: 0, total: 0 };
  let lastWrite = 0;
  let control: "pause" | "cancel" | null = null;
  const beat = async (progress?: BackgroundJob["progress"]) => {
    control = await heartbeatJob(job.id, runnerId, progress).catch(() => control);
    lastWrite = Date.now();
  };
  const lease = setInterval(() => void beat(), 30_000);
  const ctx: Context = {
    progress: async (done, total) => {
      last = { done, total };
      if (Date.now() - lastWrite > 1500) await beat({ done, total });
    },
    checkpoint: async (done, total) => {
      last = { done, total };
      if (Date.now() - lastWrite > 2000) await beat({ done, total });
      if (control === "cancel") return "cancel";
      if (control === "pause") {
        await beat({ done, total, paused: true });
        while (control === "pause") {
          await new Promise((r) => setTimeout(r, 2000));
          await beat({ done, total, paused: true });
        }
        if (control === "cancel") return "cancel";
        await beat({ done, total, paused: false });
      }
      return "continue";
    },
  };
  try {
    await beat({ done: 0, total: 0 });
    const result = await handler(job, ctx);
    await beat({ ...last });
    await finishJob(job.id, runnerId, { cancelled: Boolean(result && result.cancelled) || control === "cancel" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[jobs] ${job.kind} ${job.id} failed:`, message);
    await finishJob(job.id, runnerId, { error: message });
  } finally {
    clearInterval(lease);
  }
}

/* ── The minute's tick ─────────────────────────────────────── */

/** Due reminders, lead finder, scheduled automations — once a minute across everyone who calls it. */
export async function tick(): Promise<boolean> {
  if (!(await claimTick())) return false;
  const step = async (name: string, work: () => Promise<unknown>) =>
    work().catch((error: unknown) => console.error(`[tick] ${name} failed:`, error instanceof Error ? error.message : error));
  await step("reminders", () => fireDueReminders());
  await step("lead finder", () => runLeadFinder());
  await step("lead digests", () => runLeadDigests());
  // One job per due run; its id carries the scheduled time, so a run is never queued twice.
  await step("automations", async () => {
    const due = await query<{ id: string; org_id: string; next_run_at: Date }>(
      `SELECT id, org_id, next_run_at FROM scheduled_tasks WHERE is_enabled AND next_run_at <= now()`,
    );
    for (const t of due) {
      await enqueueJob({ kind: "scheduled-run", id: `scheduled-run-${t.id}-${t.next_run_at.getTime()}`, orgId: t.org_id, payload: { taskId: t.id, orgId: t.org_id }, maxAttempts: 2 });
    }
  });
  if (Math.random() < 0.02) await step("prune", () => pruneJobs());
  return true;
}

/* ── A long-running runner ─────────────────────────────────── */

export type RunnerOptions = { name?: string; kinds?: string[]; concurrency?: number };

const globalForRunner = globalThis as typeof globalThis & { clandarRunner?: { stop: () => Promise<void> } };

/** Starts claiming and running jobs until stopped; one per process (dev reloads don't start a second). */
export function startRunner(options: RunnerOptions = {}): { stop: () => Promise<void> } {
  if (globalForRunner.clandarRunner) return globalForRunner.clandarRunner;
  const name = options.name || process.env.RUNNER_NAME || hostname();
  const id = `${name}-${process.pid}`;
  const kinds = options.kinds?.length ? options.kinds : null;
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const running = new Map<string, Promise<void>>();
  let stopped = false;

  const checkIn = () =>
    runnerHeartbeat({ id, name, hostname: hostname(), kinds: kinds ?? JOB_KINDS, currentJob: [...running.keys()][0] ?? null }).catch(() => {});

  const loop = async () => {
    console.log(`[runner] ${id} started (${kinds?.join(", ") ?? "all jobs"}, ${concurrency} at a time)`);
    let lastTick = 0;
    let lastCheckIn = 0;
    while (!stopped) {
      try {
        if (Date.now() - lastTick > 20_000) {
          lastTick = Date.now();
          await tick();
        }
        if (Date.now() - lastCheckIn > 10_000) {
          lastCheckIn = Date.now();
          await checkIn();
        }
        let claimed = false;
        while (!stopped && running.size < concurrency) {
          const job = await claimJob(id, kinds);
          if (!job) break;
          claimed = true;
          console.log(`[runner] ${job.kind} ${job.id}`);
          const run = runJob(job, id).finally(() => {
            running.delete(job.id);
            void checkIn();
          });
          running.set(job.id, run);
          void checkIn();
        }
        await new Promise((r) => setTimeout(r, claimed ? 500 : 3000));
      } catch (error) {
        console.error("[runner] loop error:", error instanceof Error ? error.message : error);
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  };
  void loop();

  const handle = {
    stop: async () => {
      stopped = true;
      await Promise.allSettled(running.values());
      // Shows offline straight away (online = seen in the last minute), stopped about now.
      await query(`UPDATE job_runners SET last_seen = now() - interval '61 seconds', current_job = NULL WHERE id = $1`, [id]).catch(() => {});
      globalForRunner.clandarRunner = undefined;
    },
  };
  globalForRunner.clandarRunner = handle;
  return handle;
}

/**
 * For the cron on Vercel: the tick, then short jobs until the time budget runs out (long ones — Gmail
 * bulk trash, scans — wait for a runner). Returns what it did.
 */
export async function runDueWork(budgetMs: number): Promise<{ ticked: boolean; ran: number }> {
  const deadline = Date.now() + budgetMs;
  const ticked = await tick();
  const id = `cron-${process.env.VERCEL_REGION ?? "local"}-${crypto.randomUUID().slice(0, 8)}`;
  let ran = 0;
  while (Date.now() < deadline) {
    const job = await claimJob(id, SHORT_JOB_KINDS);
    if (!job) break;
    await runJob(job, id);
    ran++;
  }
  return { ticked, ran };
}
