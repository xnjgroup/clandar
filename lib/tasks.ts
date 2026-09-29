/**
 * Task management: a to-do list, a material shopping list, and permit
 * reminders — all the same table (`kind` tells them apart), optionally tied
 * to a job. Scoped to one org.
 */
import { query, queryOne } from "@/lib/db";

export type TaskKind = "todo" | "shopping" | "permit";

export type Task = {
  id: string;
  kind: TaskKind;
  title: string;
  dueDate: string | null;
  isDone: boolean;
  jobId: string | null;
  jobTitle: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  createdAt: Date;
};

type TaskRow = {
  id: string;
  kind: TaskKind;
  title: string;
  due_date: string | null;
  is_done: boolean;
  job_id: string | null;
  job_title: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  created_at: Date;
};

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    dueDate: row.due_date,
    isDone: row.is_done,
    jobId: row.job_id,
    jobTitle: row.job_title,
    assignedTo: row.assigned_to,
    assignedName: row.assigned_name,
    createdAt: row.created_at,
  };
}

const SELECT = `SELECT t.id, t.kind, t.title, t.due_date::text AS due_date, t.is_done,
       t.job_id, j.title AS job_title, t.assigned_to, p.name AS assigned_name, t.created_at
  FROM tasks t
  LEFT JOIN jobs j ON j.id = t.job_id
  LEFT JOIN people p ON p.id = t.assigned_to`;

export async function listTasks(
  orgId: string,
  filters: { jobId?: string; kind?: TaskKind; includeDone?: boolean } = {},
): Promise<Task[]> {
  const conditions = ["t.org_id = $1"];
  const params: unknown[] = [orgId];
  if (filters.jobId) {
    params.push(filters.jobId);
    conditions.push(`t.job_id = $${params.length}`);
  }
  if (filters.kind) {
    params.push(filters.kind);
    conditions.push(`t.kind = $${params.length}`);
  }
  if (!filters.includeDone) conditions.push("t.is_done = false");
  const rows = await query<TaskRow>(
    `${SELECT} WHERE ${conditions.join(" AND ")}
      ORDER BY t.is_done, t.due_date NULLS LAST, t.created_at DESC`,
    params,
  );
  return rows.map(toTask);
}

export async function createTask(input: {
  orgId: string;
  jobId: string | null;
  kind: TaskKind;
  title: string;
  dueDate: string | null;
  assignedTo: string | null;
  createdBy: string | null;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO tasks (org_id, job_id, kind, title, due_date, assigned_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.orgId, input.jobId, input.kind, input.title, input.dueDate, input.assignedTo, input.createdBy],
  );
  return row!.id;
}

export async function setTaskDone(id: string, orgId: string, done: boolean): Promise<void> {
  await query(
    `UPDATE tasks SET is_done = $3, done_at = CASE WHEN $3 THEN now() ELSE NULL END
      WHERE id = $1 AND org_id = $2`,
    [id, orgId, done],
  );
}

export async function deleteTask(id: string, orgId: string): Promise<void> {
  await query(`DELETE FROM tasks WHERE id = $1 AND org_id = $2`, [id, orgId]);
}
