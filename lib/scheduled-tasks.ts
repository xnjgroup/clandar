/**
 * Scheduled AI tasks: a recurring automation that, on its own schedule,
 * summarizes the org's real data with the org's default LLM provider and
 * records the result — see lib/scheduled-tasks-worker.ts for execution.
 * Times are UTC; this app has no per-org timezone setting yet.
 */
import type { IconName } from "@/components/icons";
import { num, query, queryOne } from "@/lib/db";
import { chatComplete, defaultLlmProvider } from "@/lib/llm-providers";
import { listGmailConnectors } from "@/lib/connectors";
import { listMail } from "@/lib/gmail";
import { WEEKDAYS, type Frequency } from "@/lib/data";

// Re-exported so existing `from "@/lib/scheduled-tasks"` imports keep working
// — the data lives in lib/data.ts because a client component (the new-task
// form) needs it too, and this module pulls in `@/lib/db` (Node-only `pg`).
export { WEEKDAYS, type Frequency } from "@/lib/data";

export type ScheduledTask = {
  id: string;
  name: string;
  description: string;
  icon: IconName;
  prompt: string;
  frequency: Frequency;
  runTime: string; // "HH:MM"
  runWeekday: number | null;
  isEnabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date;
  createdAt: Date;
};

type Row = {
  id: string;
  name: string;
  description: string;
  icon: string;
  prompt: string;
  frequency: Frequency;
  run_time: string;
  run_weekday: number | null;
  is_enabled: boolean;
  last_run_at: Date | null;
  next_run_at: Date;
  created_at: Date;
};

function toTask(r: Row): ScheduledTask {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    icon: r.icon as IconName,
    prompt: r.prompt,
    frequency: r.frequency,
    runTime: r.run_time.slice(0, 5),
    runWeekday: r.run_weekday,
    isEnabled: r.is_enabled,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    createdAt: r.created_at,
  };
}

const SELECT = `SELECT id, name, description, icon, prompt, frequency, run_time::text, run_weekday,
       is_enabled, last_run_at, next_run_at, created_at FROM scheduled_tasks`;

/** The next moment on/after `from` that satisfies `frequency`/`runTime`/`runWeekday` — looks up to 8 days ahead, which safely covers weekly. */
export function computeNextRun(
  frequency: Frequency,
  runTime: string,
  runWeekday: number | null,
  from: Date,
): Date {
  const [h, m] = runTime.split(":").map(Number);
  for (let addDays = 0; addDays < 8; addDays++) {
    const candidate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + addDays, h, m, 0, 0));
    if (candidate <= from) continue;
    const dow = candidate.getUTCDay();
    const allowed =
      frequency === "daily" ? true : frequency === "weekdays" ? dow >= 1 && dow <= 5 : dow === runWeekday;
    if (allowed) return candidate;
  }
  // Unreachable in practice (weekly can't need more than 7 days), but keeps the return type total.
  return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}

export async function listScheduledTasks(orgId: string): Promise<ScheduledTask[]> {
  const rows = await query<Row>(`${SELECT} WHERE org_id = $1 ORDER BY created_at DESC`, [orgId]);
  return rows.map(toTask);
}

export async function getScheduledTask(id: string, orgId: string): Promise<ScheduledTask | null> {
  const row = await queryOne<Row>(`${SELECT} WHERE id = $1 AND org_id = $2`, [id, orgId]);
  return row ? toTask(row) : null;
}

export async function createScheduledTask(input: {
  orgId: string;
  name: string;
  description: string;
  icon: string;
  prompt: string;
  frequency: Frequency;
  runTime: string;
  runWeekday: number | null;
  createdBy: string | null;
}): Promise<string> {
  const nextRunAt = computeNextRun(input.frequency, input.runTime, input.runWeekday, new Date());
  const row = await queryOne<{ id: string }>(
    `INSERT INTO scheduled_tasks
       (org_id, name, description, icon, prompt, frequency, run_time, run_weekday, next_run_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      input.orgId,
      input.name,
      input.description,
      input.icon,
      input.prompt,
      input.frequency,
      input.runTime,
      input.runWeekday,
      nextRunAt,
      input.createdBy,
    ],
  );
  return row!.id;
}

export async function setScheduledTaskEnabled(id: string, orgId: string, enabled: boolean): Promise<void> {
  await query(`UPDATE scheduled_tasks SET is_enabled = $3 WHERE id = $1 AND org_id = $2`, [id, orgId, enabled]);
}

export async function deleteScheduledTask(id: string, orgId: string): Promise<void> {
  await query(`DELETE FROM scheduled_tasks WHERE id = $1 AND org_id = $2`, [id, orgId]);
}

export type ScheduledTaskRun = {
  id: string;
  status: "running" | "completed" | "failed";
  output: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export async function listRuns(taskId: string, limit = 20): Promise<ScheduledTaskRun[]> {
  const rows = await query<{
    id: string;
    status: "running" | "completed" | "failed";
    output: string | null;
    error: string | null;
    started_at: Date;
    finished_at: Date | null;
  }>(
    `SELECT id, status, output, error, started_at, finished_at
       FROM scheduled_task_runs WHERE task_id = $1 ORDER BY started_at DESC LIMIT $2`,
    [taskId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    output: r.output,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  }));
}

/** A ready-made task a person can create with one click, then tweak. */
export type TaskPreset = {
  name: string;
  description: string;
  icon: IconName;
  prompt: string;
  frequency: Frequency;
  runTime: string;
  runWeekday: number | null;
};

/** A snapshot of the org's real data — the only thing a scheduled task is allowed to talk about. */
async function buildContext(orgId: string): Promise<string> {
  const [today, tasks, staleLeads, staleEstimates, recentlyCompleted] = await Promise.all([
    query<{
      project_title: string;
      customer_name: string;
      customer_phone: string | null;
      customer_email: string | null;
      project_address: string;
      project_notes: string;
      starts_at: Date;
      ends_at: Date;
    }>(
      `SELECT j.title AS project_title, c.name AS customer_name, c.phone AS customer_phone,
              c.email AS customer_email, j.address AS project_address, j.notes AS project_notes,
              s.starts_at, s.ends_at
         FROM schedule_entries s
         JOIN projects j ON j.id = s.project_id
         JOIN customers c ON c.id = j.customer_id
        WHERE s.org_id = $1 AND s.starts_at::date = current_date
        ORDER BY s.starts_at`,
      [orgId],
    ),
    query<{ title: string; due_date: string | null; kind: string }>(
      `SELECT title, due_date::text, kind FROM tasks
        WHERE org_id = $1 AND is_done = false AND (due_date IS NULL OR due_date <= current_date)
        ORDER BY due_date NULLS LAST LIMIT 20`,
      [orgId],
    ),
    query<{ title: string; customer_name: string; created_at: Date }>(
      `SELECT j.title, c.name AS customer_name, j.created_at
         FROM projects j JOIN customers c ON c.id = j.customer_id
        WHERE j.org_id = $1 AND j.status IN ('lead', 'quoted')
          AND j.created_at < now() - interval '5 days'
        ORDER BY j.created_at LIMIT 15`,
      [orgId],
    ),
    query<{ project_title: string; customer_name: string; total: string; sent_at: Date }>(
      `SELECT j.title AS project_title, c.name AS customer_name, e.total::text, e.sent_at
         FROM estimates e
         JOIN projects j ON j.id = e.project_id
         JOIN customers c ON c.id = j.customer_id
        WHERE e.org_id = $1 AND e.status = 'sent' AND e.sent_at < now() - interval '3 days'
        ORDER BY e.sent_at LIMIT 15`,
      [orgId],
    ),
    query<{ title: string; customer_name: string }>(
      `SELECT j.title, c.name AS customer_name
         FROM projects j JOIN customers c ON c.id = j.customer_id
        WHERE j.org_id = $1 AND j.status = 'completed' AND j.updated_at >= now() - interval '7 days'`,
      [orgId],
    ),
  ]);

  return JSON.stringify({
    todaysSchedule: today,
    tasksDueOrOverdue: tasks,
    projectsStaleInLeadOrQuoted: staleLeads,
    estimatesSentWithNoReplyOver3Days: staleEstimates.map((e) => ({ ...e, total: num(e.total) })),
    projectsCompletedThisWeek: recentlyCompleted,
    unreadInbox: await unreadInboxSnapshot(orgId),
  });
}

/**
 * A small, read-only snapshot of the connected inbox — up to 12 unread
 * messages (sender, subject, snippet only; never a full body fetch). Used by
 * the "Inbox triage" preset. Never trashes, labels, or sends anything, and
 * never breaks the rest of the context if there's no connector or the call
 * fails (expired token, rate limit) — those presets just won't have
 * inbox-specific data to draw on that run.
 */
async function unreadInboxSnapshot(orgId: string): Promise<
  { from: string; subject: string; snippet: string; date: Date | null }[] | null
> {
  try {
    const connectors = await listGmailConnectors(orgId);
    if (connectors.length === 0) return null;
    const mailbox = await listMail({ orgId, query: "is:unread", pageSize: 12 });
    return mailbox.messages.map((m) => ({
      from: m.from,
      subject: m.subject,
      snippet: m.snippet,
      date: m.date,
    }));
  } catch {
    return null;
  }
}

/**
 * Runs one scheduled task now: builds the context, asks the org's default LLM
 * provider, records the run, and advances `next_run_at`. Never touches
 * customer-facing data — the result is only ever written to
 * `scheduled_task_runs` for a person to read.
 */
export async function executeScheduledTask(taskId: string, orgId: string): Promise<void> {
  const task = await getScheduledTask(taskId, orgId);
  if (!task) return;

  const run = await queryOne<{ id: string }>(
    `INSERT INTO scheduled_task_runs (task_id, status) VALUES ($1, 'running') RETURNING id`,
    [taskId],
  );
  const runId = run!.id;

  try {
    const provider = await defaultLlmProvider(orgId);
    if (!provider) throw new Error("No default LLM provider is configured — set one up on /settings.");

    const context = await buildContext(orgId);
    const output = await chatComplete(provider.id, [
      {
        role: "system",
        content:
          "You are a scheduled reporting assistant for a small home-improvement business. Answer ONLY from " +
          `the JSON data snapshot given — never invent details. Data snapshot:\n${context}`,
      },
      { role: "user", content: task.prompt },
    ]);

    await query(
      `UPDATE scheduled_task_runs SET status = 'completed', output = $2, finished_at = now() WHERE id = $1`,
      [runId, output],
    );
  } catch (error) {
    await query(
      `UPDATE scheduled_task_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
      [runId, error instanceof Error ? error.message : "Unknown error"],
    );
  }

  const nextRunAt = computeNextRun(task.frequency, task.runTime, task.runWeekday, new Date());
  await query(`UPDATE scheduled_tasks SET last_run_at = now(), next_run_at = $2 WHERE id = $1`, [
    taskId,
    nextRunAt,
  ]);
}

/** Every enabled task whose `next_run_at` has arrived — what the scheduler tick polls for. */
export async function dueScheduledTasks(): Promise<{ id: string; orgId: string }[]> {
  const rows = await query<{ id: string; org_id: string }>(
    `SELECT id, org_id FROM scheduled_tasks WHERE is_enabled AND next_run_at <= now()`,
  );
  return rows.map((r) => ({ id: r.id, orgId: r.org_id }));
}

/** "Weekdays at 8:00 AM" / "Every Friday at 4:00 PM" / "Daily at 9:00 AM" — for the list and preset cards. */
export function formatSchedule(frequency: Frequency, runTime: string, runWeekday: number | null): string {
  const [h, m] = runTime.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const time = `${hour12}:${String(m).padStart(2, "0")} ${period}`;
  if (frequency === "daily") return `Daily at ${time}`;
  if (frequency === "weekdays") return `Weekdays at ${time}`;
  return `Every ${WEEKDAYS[runWeekday ?? 0]} at ${time}`;
}

export const TASK_PRESETS: TaskPreset[] = [
  {
    name: "Daily briefing",
    description: "What needs your attention today across the schedule, tasks, and projects.",
    icon: "calendar",
    frequency: "daily",
    runTime: "08:00",
    runWeekday: null,
    prompt:
      "Summarize what needs my attention today: what's on today's schedule, which tasks are due today or " +
      "overdue, and any projects still sitting in 'lead' or 'quoted' status that haven't moved in a while. " +
      "Be brief and specific — names, not generalities.",
  },
  {
    name: "Weekly review",
    description: "A Friday summary of projects, revenue, and what's coming up next week.",
    icon: "chart",
    frequency: "weekly",
    runTime: "16:00",
    runWeekday: 5,
    prompt:
      "Summarize this week: projects completed, total amount quoted and invoiced, what's scheduled for next " +
      "week, and any tasks that are overdue. Call out anything that looks like it's falling behind.",
  },
  {
    name: "Follow-up reminders",
    description: "Estimates sent with no response yet, plus overdue tasks and permits.",
    icon: "clipboard",
    frequency: "weekdays",
    runTime: "08:00",
    runWeekday: null,
    prompt:
      "List estimates that were sent more than 3 days ago with no reply yet, and any overdue tasks or " +
      "permit reminders. For each, say how long it's been waiting.",
  },
  {
    name: "Inbox triage",
    description: "Categorize unread email and flag anything that looks urgent.",
    icon: "mail",
    frequency: "weekdays",
    runTime: "08:00",
    runWeekday: null,
    prompt:
      "Look at the unread inbox snapshot. Group the messages into categories (customer replies, new leads, " +
      "supplier/vendor, spam-looking, other), and call out anything that looks time-sensitive or from a " +
      "customer waiting on a reply. If there's no inbox data, say a Gmail account isn't connected on " +
      "/connectors. Never draft or suggest sending anything — just triage.",
  },
  {
    name: "Site visit prep",
    description: "A short brief before each project on today's schedule — contact info, address, notes.",
    icon: "briefcase",
    frequency: "weekdays",
    runTime: "07:30",
    runWeekday: null,
    prompt:
      "For each project on today's schedule, give a short brief: customer name and contact info, project address, " +
      "and anything in the project notes worth knowing before showing up. One paragraph per project.",
  },
  {
    name: "Content ideas",
    description: "A few social-post ideas each week from projects finished recently.",
    icon: "camera",
    frequency: "weekly",
    runTime: "09:00",
    runWeekday: 1,
    prompt:
      "Suggest 3 short social media post ideas based on projects completed this week — a before/after angle, a " +
      "customer-satisfaction angle, whatever fits what actually got done. If nothing was completed this " +
      "week, say so instead of inventing a project.",
  },
];
