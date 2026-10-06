/**
 * Firing due reminders. A reminder task is due at due_date + remind_time
 * (09:00 when unset), as wall-clock time in the task's `time_zone`. Every few
 * minutes something calls `fireDueReminders` — the job runners' minute tick (lib/job-runner.ts)
 * and/or /api/cron/tick or /api/cron/reminders (Vercel Cron or
 * an external pinger). Each due reminder is claimed with one atomic UPDATE
 * (setting `reminded_at`) before anything is sent, so two schedulers running
 * at once still notify only once.
 *
 * Who hears about it: the task's assignee, or whoever created it when no one
 * is assigned. How: an in-app notification (the header bell), a browser push
 * to every browser they enabled, and an email from the org's Gmail connector.
 */
import { query } from "@/lib/db";
import { sendMail, sendableGmailConnectorId } from "@/lib/gmail";
import { createNotification } from "@/lib/notifications";
import { pushToPerson } from "@/lib/push";

const DUE_AT = `((t.due_date + coalesce(t.remind_time, time '09:00')) AT TIME ZONE t.time_zone)`;

type Claimed = {
  id: string;
  org_id: string;
  title: string;
  notes: string;
  due_at: Date;
  time_zone: string;
  recipient_id: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  project_title: string | null;
};

/** Sends every reminder that has come due and not been sent yet. Returns how many fired. */
export async function fireDueReminders(options: { appUrl?: string | null } = {}): Promise<number> {
  const appUrl = (options.appUrl || process.env.APP_URL || "").replace(/\/+$/, "");
  const claimed = await query<Claimed>(
    `WITH due AS (
       SELECT t.id FROM tasks t
        WHERE t.kind = 'reminder' AND NOT t.is_done AND t.reminded_at IS NULL
          AND t.due_date IS NOT NULL AND ${DUE_AT} <= now()
        ORDER BY t.due_date LIMIT 200
        FOR UPDATE SKIP LOCKED
     ), marked AS (
       UPDATE tasks t SET reminded_at = now() FROM due WHERE t.id = due.id
       RETURNING t.id, t.org_id, t.title, t.notes, t.time_zone, ${DUE_AT} AS due_at,
                 coalesce(t.assigned_to, t.created_by) AS recipient_id, t.project_id
     )
     SELECT m.id, m.org_id, m.title, m.notes, m.due_at, m.time_zone, m.recipient_id,
            p.name AS recipient_name, p.email AS recipient_email, j.title AS project_title
       FROM marked m
       LEFT JOIN people p ON p.id = m.recipient_id
       LEFT JOIN projects j ON j.id = m.project_id`,
  );

  for (const r of claimed) {
    if (!r.recipient_id) continue;
    const when = r.due_at.toLocaleString("en-US", {
      timeZone: r.time_zone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const title = `Reminder: ${r.title}`;
    const body = [r.project_title ? `Project: ${r.project_title}` : null, when, r.notes || null]
      .filter(Boolean)
      .join(" · ");
    const link = `/tasks/${r.id}`;

    // Each channel on its own — one failing (e.g. Gmail not connected) doesn't stop the others.
    await createNotification({ orgId: r.org_id, personId: r.recipient_id, title, body, link }).catch(() => {});
    await pushToPerson(r.recipient_id, { title, body, link }).catch(() => {});
    if (r.recipient_email) {
      try {
        const connectorId = await sendableGmailConnectorId(r.org_id);
        if (connectorId) {
          await sendMail({
            orgId: r.org_id,
            connectorId,
            to: r.recipient_email,
            subject: title,
            body: [
              `Hi ${r.recipient_name?.split(/\s+/)[0] || "there"},`,
              ``,
              `This is your reminder: ${r.title}`,
              r.project_title ? `Project: ${r.project_title}` : null,
              `Due: ${when}`,
              r.notes ? `\n${r.notes}` : null,
              appUrl ? `\nOpen it: ${appUrl}${link}` : null,
            ]
              .filter((l) => l !== null)
              .join("\n"),
          });
        }
      } catch {
        // Email is best-effort; the bell and push already went out.
      }
    }
  }
  return claimed.length;
}

export type UpcomingReminder = {
  id: string;
  title: string;
  dueAt: Date;
  timeZone: string;
  repeat: string;
  projectId: string | null;
  projectTitle: string | null;
  assignedName: string | null;
  overdue: boolean;
};

/** Open reminders due within the window (and any already overdue), soonest first — for the schedule page. */
export async function listUpcomingReminders(
  orgId: string,
  to: Date,
  filters: { assignedTo?: string } = {},
): Promise<UpcomingReminder[]> {
  const rows = await query<{
    id: string;
    title: string;
    due_at: Date;
    time_zone: string;
    repeat: string;
    project_id: string | null;
    project_title: string | null;
    assigned_name: string | null;
  }>(
    `SELECT t.id, t.title, ${DUE_AT} AS due_at, t.time_zone, t.repeat, t.project_id, j.title AS project_title,
            p.name AS assigned_name
       FROM tasks t
       LEFT JOIN projects j ON j.id = t.project_id
       LEFT JOIN people p ON p.id = t.assigned_to
      WHERE t.org_id = $1 AND t.kind = 'reminder' AND NOT t.is_done AND t.due_date IS NOT NULL
        AND ${DUE_AT} <= $2 AND ($3::uuid IS NULL OR t.assigned_to = $3)
      ORDER BY due_at LIMIT 50`,
    [orgId, to, filters.assignedTo ?? null],
  );
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    dueAt: r.due_at,
    timeZone: r.time_zone,
    repeat: r.repeat,
    projectId: r.project_id,
    projectTitle: r.project_title,
    assignedName: r.assigned_name,
    overdue: r.due_at.getTime() < now,
  }));
}
