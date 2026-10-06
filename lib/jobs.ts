/**
 * Background jobs in Postgres — the queue that replaced BullMQ / Redis. Anything can enqueue; any
 * runner (lib/job-runner.ts) claims the oldest ready job with FOR UPDATE SKIP LOCKED (so two runners
 * never take the same one), holds a lease it renews while working, and reports progress, completion
 * or failure here. Failed jobs retry with backoff up to `max_attempts`; a lapsed lease (the runner
 * died) puts the job back in line. Pause / cancel are a `control` flag the job's code checks.
 */
import { query, queryOne } from "@/lib/db";

export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export type BackgroundJob = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  orgId: string | null;
  status: JobState;
  control: "pause" | "cancel" | null;
  progress: { done?: number; total?: number; paused?: boolean; note?: string };
  error: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lockedBy: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

type JobRow = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  org_id: string | null;
  status: JobState;
  control: "pause" | "cancel" | null;
  progress: BackgroundJob["progress"];
  error: string | null;
  attempts: number;
  max_attempts: number;
  run_after: Date;
  locked_by: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
};

const toJob = (r: JobRow): BackgroundJob => ({
  id: r.id,
  kind: r.kind,
  payload: r.payload,
  orgId: r.org_id,
  status: r.status,
  control: r.control,
  progress: r.progress ?? {},
  error: r.error,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  runAfter: r.run_after,
  lockedBy: r.locked_by,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

export const LEASE_SECONDS = 120;

/**
 * Adds a job. With an `id`, asking again while that job is still queued or running returns it
 * instead of starting a duplicate; a finished one with that id is replaced by a fresh run.
 */
export async function enqueueJob(input: {
  kind: string;
  payload: Record<string, unknown>;
  orgId?: string | null;
  id?: string;
  maxAttempts?: number;
  runAfter?: Date;
}): Promise<BackgroundJob> {
  const id = input.id ?? `${input.kind}-${crypto.randomUUID()}`;
  const row = await queryOne<JobRow>(
    `INSERT INTO background_jobs (id, kind, payload, org_id, max_attempts, run_after)
     VALUES ($1, $2, $3, $4, $5, coalesce($6, now()))
     ON CONFLICT (id) DO UPDATE
        SET kind = EXCLUDED.kind, payload = EXCLUDED.payload, org_id = EXCLUDED.org_id, status = 'queued', control = NULL,
            progress = '{}', error = NULL, attempts = 0, max_attempts = EXCLUDED.max_attempts, run_after = EXCLUDED.run_after,
            locked_by = NULL, lease_until = NULL, created_at = now(), started_at = NULL, finished_at = NULL, updated_at = now()
      WHERE background_jobs.status IN ('completed', 'failed', 'cancelled')
     RETURNING *`,
    [id, input.kind, JSON.stringify(input.payload), input.orgId ?? null, input.maxAttempts ?? 3, input.runAfter ?? null],
  );
  // Still queued / running: hand back the one in flight.
  return toJob(row ?? (await queryOne<JobRow>(`SELECT * FROM background_jobs WHERE id = $1`, [id]))!);
}

/** The next job this runner may take (its kinds, or any), leased to it — or null when there's nothing to do. */
export async function claimJob(runnerId: string, kinds: string[] | null): Promise<BackgroundJob | null> {
  const row = await queryOne<JobRow>(
    `UPDATE background_jobs j
        SET status = 'running', locked_by = $1, lease_until = now() + make_interval(secs => $3),
            attempts = j.attempts + 1, started_at = coalesce(j.started_at, now()), updated_at = now()
      WHERE j.id = (
        SELECT id FROM background_jobs
         WHERE ((status = 'queued' AND run_after <= now())
                OR (status = 'running' AND lease_until < now()))
           AND ($2::text[] IS NULL OR kind = ANY ($2::text[]))
         ORDER BY run_after
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING j.*`,
    [runnerId, kinds, LEASE_SECONDS],
  );
  if (!row) return null;
  // A job whose lease lapsed too often (it keeps killing its runner) is given up on.
  if (row.attempts > row.max_attempts) {
    await finishJob(row.id, runnerId, { error: "Stopped after too many attempts." }, false);
    return null;
  }
  return toJob(row);
}

/** Renews the lease and records progress; returns the job's control flag (pause / cancel) for the job's code. */
export async function heartbeatJob(id: string, runnerId: string, progress?: BackgroundJob["progress"]): Promise<"pause" | "cancel" | null> {
  const row = await queryOne<{ control: "pause" | "cancel" | null }>(
    `UPDATE background_jobs SET lease_until = now() + make_interval(secs => $3), updated_at = now(),
            progress = CASE WHEN $4::jsonb IS NULL THEN progress ELSE $4::jsonb END
      WHERE id = $1 AND locked_by = $2 AND status = 'running' RETURNING control`,
    [id, runnerId, LEASE_SECONDS, progress ? JSON.stringify(progress) : null],
  );
  return row?.control ?? null;
}

/**
 * The job's done: completed, cancelled, or failed — a failure with attempts left goes back in line
 * after a backoff (30 s, 2 min, 8 min …) unless `retry` is false.
 */
export async function finishJob(id: string, runnerId: string, outcome: { cancelled?: boolean; error?: string }, retry = true): Promise<void> {
  if (outcome.error) {
    await query(
      `UPDATE background_jobs
          SET status = CASE WHEN $3 AND attempts < max_attempts THEN 'queued' ELSE 'failed' END,
              run_after = now() + make_interval(secs => 30 * power(4, greatest(attempts - 1, 0))),
              error = $4, locked_by = NULL, lease_until = NULL, updated_at = now(),
              finished_at = CASE WHEN $3 AND attempts < max_attempts THEN NULL ELSE now() END
        WHERE id = $1 AND locked_by = $2`,
      [id, runnerId, retry, outcome.error.slice(0, 2000)],
    );
    return;
  }
  await query(
    `UPDATE background_jobs SET status = $3, control = NULL, locked_by = NULL, lease_until = NULL, finished_at = now(), updated_at = now()
      WHERE id = $1 AND locked_by = $2`,
    [id, runnerId, outcome.cancelled ? "cancelled" : "completed"],
  );
}

export async function getJob(id: string): Promise<BackgroundJob | null> {
  const row = await queryOne<JobRow>(`SELECT * FROM background_jobs WHERE id = $1`, [id]);
  return row ? toJob(row) : null;
}

/** Pause / resume / cancel from the UI. Cancelling a job that hasn't started just cancels it. */
export async function setJobControl(id: string, control: "pause" | "cancel" | null): Promise<void> {
  await query(
    `UPDATE background_jobs SET control = $2, updated_at = now(),
            status = CASE WHEN $2 = 'cancel' AND status = 'queued' THEN 'cancelled' ELSE status END,
            finished_at = CASE WHEN $2 = 'cancel' AND status = 'queued' THEN now() ELSE finished_at END
      WHERE id = $1`,
    [id, control],
  );
}

/** Admin → Retry: a failed or cancelled job goes back in line. */
export async function retryJob(id: string): Promise<void> {
  await query(
    `UPDATE background_jobs SET status = 'queued', control = NULL, error = NULL, attempts = 0, run_after = now(),
            progress = '{}', finished_at = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('failed', 'cancelled')`,
    [id],
  );
}

/** Jobs of these kinds still queued or running (for the assistant's Updates). */
export async function activeJobs(kinds: string[]): Promise<BackgroundJob[]> {
  const rows = await query<JobRow>(
    `SELECT * FROM background_jobs WHERE kind = ANY ($1) AND status IN ('queued', 'running') ORDER BY created_at`,
    [kinds],
  );
  return rows.map(toJob);
}

/* ── Admin ─────────────────────────────────────────────────── */

export type JobRunner = { id: string; name: string; hostname: string; kinds: string[]; currentJob: string | null; startedAt: Date; lastSeen: Date; online: boolean };

export async function recentJobs(limit = 50): Promise<(BackgroundJob & { orgName: string | null })[]> {
  const rows = await query<JobRow & { org_name: string | null }>(
    `SELECT j.*, o.name AS org_name FROM background_jobs j LEFT JOIN organizations o ON o.id = j.org_id
      ORDER BY (j.status IN ('running', 'queued')) DESC, j.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ ...toJob(r), orgName: r.org_name }));
}

export async function listRunners(): Promise<JobRunner[]> {
  const rows = await query<{ id: string; name: string; hostname: string; kinds: string[]; current_job: string | null; started_at: Date; last_seen: Date; online: boolean }>(
    `SELECT *, last_seen > now() - interval '60 seconds' AS online FROM job_runners
      WHERE last_seen > now() - interval '7 days' ORDER BY online DESC, last_seen DESC`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, hostname: r.hostname, kinds: r.kinds, currentJob: r.current_job, startedAt: r.started_at, lastSeen: r.last_seen, online: r.online }));
}

export async function jobCounts(): Promise<{ queued: number; running: number; failed: number }> {
  const row = await queryOne<{ queued: number; running: number; failed: number }>(
    `SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued, count(*) FILTER (WHERE status = 'running')::int AS running,
            count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '7 days')::int AS failed
       FROM background_jobs`,
  );
  return row ?? { queued: 0, running: 0, failed: 0 };
}

/** A runner checking in (every few seconds while it runs). */
export async function runnerHeartbeat(runner: { id: string; name: string; hostname: string; kinds: string[]; currentJob: string | null }): Promise<void> {
  await query(
    `INSERT INTO job_runners (id, name, hostname, kinds, current_job) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, hostname = EXCLUDED.hostname, kinds = EXCLUDED.kinds,
                                    current_job = EXCLUDED.current_job, last_seen = now()`,
    [runner.id, runner.name, runner.hostname, runner.kinds, runner.currentJob],
  );
}

/** The minute's tick goes to one caller only: true when this one moved it forward. */
export async function claimTick(name = "main", everySeconds = 55): Promise<boolean> {
  const row = await queryOne<{ name: string }>(
    `INSERT INTO job_ticks (name, last_at) VALUES ($1, now())
     ON CONFLICT (name) DO UPDATE SET last_at = now() WHERE job_ticks.last_at < now() - make_interval(secs => $2)
     RETURNING name`,
    [name, everySeconds],
  );
  return Boolean(row);
}

/** Old finished jobs are cleared after 14 days. */
export async function pruneJobs(): Promise<void> {
  await query(`DELETE FROM background_jobs WHERE status IN ('completed', 'cancelled', 'failed') AND finished_at < now() - interval '14 days'`);
}
