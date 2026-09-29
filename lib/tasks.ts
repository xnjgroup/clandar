/**
 * Task management: a to-do list, a shopping list, and reminders — all the
 * same table (`kind` tells them apart), optionally tied to a project.
 * Scoped to one org.
 *
 * Each kind carries its own details on top of the shared title/notes/due
 * date: a to-do has checklist steps and a shopping list has items (both in
 * `task_items`), a shopping list also has a store, and a reminder has a time
 * of day and a repeat.
 */
import { query, queryOne } from "@/lib/db";
import { REPEATS, TASK_KINDS, type Repeat, type TaskKind } from "@/lib/task-kinds";

export { REPEATS, TASK_KINDS, type Repeat, type TaskKind };

export type Task = {
  id: string;
  kind: TaskKind;
  title: string;
  notes: string;
  dueDate: string | null;
  isDone: boolean;
  projectId: string | null;
  projectTitle: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  store: string;
  /** "HH:MM", reminders only. */
  remindTime: string | null;
  repeat: Repeat;
  itemCount: number;
  itemsDone: number;
  createdAt: Date;
};

export type TaskItem = {
  id: string;
  label: string;
  quantity: number | null;
  unit: string;
  /** An http(s) reference link, or null. */
  url: string | null;
  isDone: boolean;
};

type TaskRow = {
  id: string;
  kind: TaskKind;
  title: string;
  notes: string;
  due_date: string | null;
  is_done: boolean;
  project_id: string | null;
  project_title: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  store: string;
  remind_time: string | null;
  repeat: Repeat;
  item_count: number;
  items_done: number;
  created_at: Date;
};

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    notes: row.notes,
    dueDate: row.due_date,
    isDone: row.is_done,
    projectId: row.project_id,
    projectTitle: row.project_title,
    assignedTo: row.assigned_to,
    assignedName: row.assigned_name,
    store: row.store,
    remindTime: row.remind_time,
    repeat: row.repeat,
    itemCount: row.item_count,
    itemsDone: row.items_done,
    createdAt: row.created_at,
  };
}

const SELECT = `SELECT t.id, t.kind, t.title, t.notes, t.due_date::text AS due_date, t.is_done,
       t.project_id, j.title AS project_title, t.assigned_to, p.name AS assigned_name,
       t.store, to_char(t.remind_time, 'HH24:MI') AS remind_time, t.repeat,
       (SELECT count(*)::int FROM task_items i WHERE i.task_id = t.id) AS item_count,
       (SELECT count(*)::int FROM task_items i WHERE i.task_id = t.id AND i.is_done) AS items_done,
       t.created_at
  FROM tasks t
  LEFT JOIN projects j ON j.id = t.project_id
  LEFT JOIN people p ON p.id = t.assigned_to`;

export async function listTasks(
  orgId: string,
  filters: { projectId?: string; kind?: TaskKind; includeDone?: boolean } = {},
): Promise<Task[]> {
  const conditions = ["t.org_id = $1"];
  const params: unknown[] = [orgId];
  if (filters.projectId) {
    params.push(filters.projectId);
    conditions.push(`t.project_id = $${params.length}`);
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

export async function getTask(id: string, orgId: string): Promise<Task | null> {
  const row = await queryOne<TaskRow>(`${SELECT} WHERE t.id = $1 AND t.org_id = $2`, [id, orgId]);
  return row ? toTask(row) : null;
}

export async function createTask(input: {
  orgId: string;
  projectId: string | null;
  kind: TaskKind;
  title: string;
  notes?: string;
  dueDate: string | null;
  assignedTo: string | null;
  createdBy: string | null;
  /** Checklist steps or shopping items to start the task with. */
  items?: string[];
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO tasks (org_id, project_id, kind, title, notes, due_date, assigned_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.orgId,
      input.projectId,
      input.kind,
      input.title,
      input.notes ?? "",
      input.dueDate,
      input.assignedTo,
      input.createdBy,
    ],
  );
  const id = row!.id;
  for (const label of input.items ?? []) {
    if (label.trim()) await query(`INSERT INTO task_items (task_id, label) VALUES ($1, $2)`, [id, label.trim()]);
  }
  return id;
}

export async function updateTask(
  id: string,
  orgId: string,
  input: {
    title: string;
    notes: string;
    dueDate: string | null;
    assignedTo: string | null;
    store: string;
    remindTime: string | null;
    repeat: Repeat;
  },
): Promise<void> {
  await query(
    `UPDATE tasks SET title = $3, notes = $4, due_date = $5, assigned_to = $6, store = $7,
            remind_time = $8, repeat = $9
      WHERE id = $1 AND org_id = $2`,
    [id, orgId, input.title, input.notes, input.dueDate, input.assignedTo, input.store, input.remindTime, input.repeat],
  );
}

const REPEAT_INTERVAL: Record<Exclude<Repeat, "none">, string> = {
  daily: "1 day",
  weekly: "7 days",
  monthly: "1 month",
  yearly: "1 year",
};

/**
 * Marking a repeating reminder done moves it to its next date instead of
 * closing it — from its current due date, or from today if it has none.
 */
export async function setTaskDone(id: string, orgId: string, done: boolean): Promise<void> {
  const task = await queryOne<{ kind: TaskKind; repeat: Repeat }>(
    `SELECT kind, repeat FROM tasks WHERE id = $1 AND org_id = $2`,
    [id, orgId],
  );
  if (!task) return;
  if (done && task.kind === "reminder" && task.repeat !== "none") {
    await query(
      `UPDATE tasks SET due_date = (coalesce(due_date, current_date) + $3::interval)::date
        WHERE id = $1 AND org_id = $2`,
      [id, orgId, REPEAT_INTERVAL[task.repeat]],
    );
    return;
  }
  await query(
    `UPDATE tasks SET is_done = $3, done_at = CASE WHEN $3 THEN now() ELSE NULL END
      WHERE id = $1 AND org_id = $2`,
    [id, orgId, done],
  );
}

export async function deleteTask(id: string, orgId: string): Promise<void> {
  await query(`DELETE FROM tasks WHERE id = $1 AND org_id = $2`, [id, orgId]);
}

/* ── Checklist steps / shopping items ─────────────────────────
   Every item query joins back to `tasks` so an item can only be touched
   through a task in the caller's org. */

export async function listTaskItems(taskId: string, orgId: string): Promise<TaskItem[]> {
  const rows = await query<{
    id: string;
    label: string;
    quantity: string | null;
    unit: string;
    url: string | null;
    is_done: boolean;
  }>(
    `SELECT i.id, i.label, i.quantity::text, i.unit, i.url, i.is_done
       FROM task_items i JOIN tasks t ON t.id = i.task_id
      WHERE i.task_id = $1 AND t.org_id = $2
      ORDER BY i.created_at`,
    [taskId, orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    quantity: r.quantity === null ? null : Number(r.quantity),
    unit: r.unit,
    url: r.url,
    isDone: r.is_done,
  }));
}

export async function addTaskItem(
  taskId: string,
  orgId: string,
  input: { label: string; quantity: number | null; unit: string; url: string | null },
): Promise<void> {
  await query(
    `INSERT INTO task_items (task_id, label, quantity, unit, url)
     SELECT id, $3, $4, $5, $6 FROM tasks WHERE id = $1 AND org_id = $2`,
    [taskId, orgId, input.label, input.quantity, input.unit, input.url],
  );
}

export async function setTaskItemDone(itemId: string, orgId: string, done: boolean): Promise<void> {
  await query(
    `UPDATE task_items i SET is_done = $3 FROM tasks t
      WHERE i.id = $1 AND t.id = i.task_id AND t.org_id = $2`,
    [itemId, orgId, done],
  );
}

export async function deleteTaskItem(itemId: string, orgId: string): Promise<void> {
  await query(
    `DELETE FROM task_items i USING tasks t
      WHERE i.id = $1 AND t.id = i.task_id AND t.org_id = $2`,
    [itemId, orgId],
  );
}
