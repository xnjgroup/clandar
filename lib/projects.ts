/**
 * Projects: one property, one project — the hub every other feature (quoting,
 * scheduling, project records, tasks) hangs a record off. Scoped to one org.
 */
import { query, queryOne } from "@/lib/db";
import { PROJECT_STATUSES, shortDate, type ProjectStatus } from "@/lib/data";
import { deleteUpload } from "@/lib/storage";

// Re-exported so existing `from "@/lib/projects"` imports keep working — the
// data itself lives in lib/data.ts because it's plain presentation config
// that a client component (e.g. the new-project form) needs too, and
// lib/projects.ts pulls in `@/lib/db` (Node-only `pg`), which can never reach
// a client bundle.
export { PROJECT_STATUSES, type ProjectStatus } from "@/lib/data";

export type Project = {
  id: string;
  title: string;
  projectTypeId: string | null;
  projectTypeName: string | null;
  projectTypeIcon: string | null;
  address: string;
  status: ProjectStatus;
  notes: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  /** "YYYY-MM-DD", or null when no due date is set. */
  dueDate: string | null;
  /** Sum and count of the invoices/receipts linked to the project (its spend). */
  invoicesTotal: number;
  invoiceCount: number;
  /** The most recent estimate (quote) on the project, if any. */
  latestEstimate: { total: number; status: "draft" | "sent" | "accepted" | "declined" } | null;
  /** The project's tasks, and how many are marked done — its progress. */
  taskCount: number;
  tasksDone: number;
  createdAt: Date;
  updatedAt: Date;
};

type ProjectRow = {
  id: string;
  title: string;
  project_type_id: string | null;
  project_type_name: string | null;
  project_type_icon: string | null;
  address: string;
  status: ProjectStatus;
  notes: string;
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  due_date: string | null;
  invoices_total: string;
  invoice_count: number;
  estimate_total: string | null;
  estimate_status: "draft" | "sent" | "accepted" | "declined" | null;
  task_count: number;
  tasks_done: number;
  created_at: Date;
  updated_at: Date;
};

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    projectTypeId: row.project_type_id,
    projectTypeName: row.project_type_name,
    projectTypeIcon: row.project_type_icon,
    address: row.address,
    status: row.status,
    notes: row.notes,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    assignedTo: row.assigned_to,
    assignedName: row.assigned_name,
    dueDate: row.due_date,
    invoicesTotal: Number(row.invoices_total),
    invoiceCount: row.invoice_count,
    latestEstimate:
      row.estimate_status !== null ? { total: Number(row.estimate_total), status: row.estimate_status } : null,
    taskCount: row.task_count,
    tasksDone: row.tasks_done,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = `SELECT j.id, j.title, j.project_type_id, pt.name AS project_type_name, pt.icon AS project_type_icon,
       j.address, j.status, j.notes, j.due_date::text AS due_date, j.created_at, j.updated_at,
       c.id AS customer_id, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
       p.id AS assigned_to, p.name AS assigned_name,
       le.total::text AS estimate_total, le.status AS estimate_status,
       (SELECT coalesce(sum(i.amount), 0)::text FROM invoices i WHERE i.project_id = j.id) AS invoices_total,
       (SELECT count(*)::int FROM invoices i WHERE i.project_id = j.id) AS invoice_count,
       (SELECT count(*)::int FROM tasks t WHERE t.project_id = j.id) AS task_count,
       (SELECT count(*)::int FROM tasks t WHERE t.project_id = j.id AND t.is_done) AS tasks_done
  FROM projects j
  JOIN customers c ON c.id = j.customer_id
  LEFT JOIN people p ON p.id = j.assigned_to
  LEFT JOIN project_types pt ON pt.id = j.project_type_id
  LEFT JOIN LATERAL (
    SELECT e.total, e.status FROM estimates e WHERE e.project_id = j.id ORDER BY e.created_at DESC LIMIT 1
  ) le ON true`;

export async function listProjects(
  orgId: string,
  filters: { status?: ProjectStatus; customerId?: string; assignedTo?: string } = {},
): Promise<Project[]> {
  const conditions = ["j.org_id = $1"];
  const params: unknown[] = [orgId];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`j.status = $${params.length}`);
  }
  if (filters.customerId) {
    params.push(filters.customerId);
    conditions.push(`j.customer_id = $${params.length}`);
  }
  if (filters.assignedTo) {
    params.push(filters.assignedTo);
    conditions.push(`j.assigned_to = $${params.length}`);
  }
  const rows = await query<ProjectRow>(
    `${SELECT} WHERE ${conditions.join(" AND ")} ORDER BY j.created_at DESC`,
    params,
  );
  return rows.map(toProject);
}

export async function getProject(id: string, orgId: string): Promise<Project | null> {
  const row = await queryOne<ProjectRow>(`${SELECT} WHERE j.id = $1 AND j.org_id = $2`, [id, orgId]);
  return row ? toProject(row) : null;
}

export async function projectCountsByStatus(orgId: string): Promise<Record<ProjectStatus, number>> {
  const rows = await query<{ status: ProjectStatus; count: string }>(
    `SELECT status, count(*)::text AS count FROM projects WHERE org_id = $1 GROUP BY status`,
    [orgId],
  );
  const counts = Object.fromEntries(PROJECT_STATUSES.map((s) => [s.id, 0])) as Record<ProjectStatus, number>;
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}

export async function createProject(input: {
  orgId: string;
  customerId: string;
  title: string;
  projectTypeId: string | null;
  address: string;
  notes: string;
  dueDate?: string | null;
  createdBy: string | null;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO projects (org_id, customer_id, title, project_type_id, address, notes, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.orgId,
      input.customerId,
      input.title,
      input.projectTypeId,
      input.address,
      input.notes,
      input.dueDate ?? null,
      input.createdBy,
    ],
  );
  return row!.id;
}

export async function updateProject(
  id: string,
  orgId: string,
  input: { title: string; projectTypeId: string | null; address: string; notes: string; dueDate: string | null },
): Promise<void> {
  await query(
    `UPDATE projects SET title = $3, project_type_id = $4, address = $5, notes = $6, due_date = $7
      WHERE id = $1 AND org_id = $2`,
    [id, orgId, input.title, input.projectTypeId, input.address, input.notes, input.dueDate],
  );
}

/**
 * "Due Oct 12 · in 3 days" / "Due today" / "Overdue by 2 days" for a project's
 * due date — never overdue once the project is completed or cancelled.
 */
export function describeDue(
  dueDate: string | null,
  status: ProjectStatus,
): { label: string; overdue: boolean } | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const date = shortDate(dueDate);
  if (status === "completed" || status === "cancelled") return { label: `Due ${date}`, overdue: false };
  if (days < 0) return { label: `Overdue by ${-days} day${days === -1 ? "" : "s"} · ${date}`, overdue: true };
  if (days === 0) return { label: `Due today · ${date}`, overdue: false };
  return { label: `Due ${date} · in ${days} day${days === 1 ? "" : "s"}`, overdue: false };
}

export async function setProjectStatus(id: string, orgId: string, status: ProjectStatus): Promise<void> {
  await query(`UPDATE projects SET status = $3 WHERE id = $1 AND org_id = $2`, [id, orgId, status]);
}

export async function assignProject(id: string, orgId: string, assignedTo: string | null): Promise<void> {
  await query(`UPDATE projects SET assigned_to = $3 WHERE id = $1 AND org_id = $2`, [id, orgId, assignedTo]);
}

/**
 * Deleting a project cascades every DB row hanging off it (photos, files,
 * estimates, schedule entries, tasks) — but the actual bytes on disk for its
 * photos and files live outside Postgres (lib/storage.ts) and have to be
 * cleaned up first, or they'd be orphaned forever.
 */
export async function deleteProject(id: string, orgId: string): Promise<void> {
  const paths = await query<{ file_path: string }>(
    `SELECT file_path FROM project_photos WHERE project_id = $1
     UNION ALL
     SELECT file_path FROM project_files WHERE project_id = $1`,
    [id],
  );
  await query(`DELETE FROM projects WHERE id = $1 AND org_id = $2`, [id, orgId]);
  await Promise.all(paths.map((p) => deleteUpload(p.file_path)));
}

export type ProjectOverview = {
  active: number;
  activeOverdue: number;
  leads: number;
  quoted: number;
  quotesOut: number;
  tasksToday: number;
  tasksOverdue: number;
  jobsThisWeek: number;
  newLeads: number;
};

/** Headline numbers for the overview's Projects row. "Today" is the database's date. */
export async function projectOverview(orgId: string): Promise<ProjectOverview> {
  const row = await queryOne<{
    active: number;
    active_overdue: number;
    leads: number;
    quoted: number;
    quotes_out: string;
    tasks_today: number;
    tasks_overdue: number;
    jobs_week: number;
    new_leads: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM projects WHERE org_id = $1 AND status IN ('scheduled', 'in_progress')) AS active,
       (SELECT count(*)::int FROM projects WHERE org_id = $1 AND status IN ('scheduled', 'in_progress')
          AND due_date < current_date) AS active_overdue,
       (SELECT count(*)::int FROM projects WHERE org_id = $1 AND status = 'lead') AS leads,
       (SELECT count(*)::int FROM projects WHERE org_id = $1 AND status = 'quoted') AS quoted,
       (SELECT coalesce(sum(total), 0)::text FROM estimates WHERE org_id = $1 AND status = 'sent') AS quotes_out,
       (SELECT count(*)::int FROM tasks WHERE org_id = $1 AND NOT is_done AND due_date = current_date) AS tasks_today,
       (SELECT count(*)::int FROM tasks WHERE org_id = $1 AND NOT is_done AND due_date < current_date) AS tasks_overdue,
       (SELECT count(*)::int FROM schedule_entries WHERE org_id = $1
          AND starts_at >= now() AND starts_at < now() + interval '7 days') AS jobs_week,
       (SELECT count(*)::int FROM email_leads WHERE org_id = $1 AND status = 'new') AS new_leads`,
    [orgId],
  );
  return {
    active: row?.active ?? 0,
    activeOverdue: row?.active_overdue ?? 0,
    leads: row?.leads ?? 0,
    quoted: row?.quoted ?? 0,
    quotesOut: Number(row?.quotes_out ?? 0),
    tasksToday: row?.tasks_today ?? 0,
    tasksOverdue: row?.tasks_overdue ?? 0,
    jobsThisWeek: row?.jobs_week ?? 0,
    newLeads: row?.new_leads ?? 0,
  };
}

