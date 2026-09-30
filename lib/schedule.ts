/**
 * Scheduling: one calendar entry is a time window — "what's happening"
 * (`notes`), optionally on a project and assigned to a crew member. The daily "route" (lib/data doesn't need this — see
 * app/(dashboard)/schedule/page.tsx) is just this list filtered to one day
 * and person, ordered by start time.
 */
import { query, queryOne } from "@/lib/db";

export type ScheduleEntry = {
  id: string;
  projectId: string | null;
  projectTitle: string | null;
  projectAddress: string | null;
  customerName: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  startsAt: Date;
  endsAt: Date;
  notes: string;
};

type ScheduleRow = {
  id: string;
  project_id: string | null;
  project_title: string | null;
  project_address: string | null;
  customer_name: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  starts_at: Date;
  ends_at: Date;
  notes: string;
};

function toEntry(row: ScheduleRow): ScheduleEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    projectTitle: row.project_title,
    projectAddress: row.project_address,
    customerName: row.customer_name,
    assignedTo: row.assigned_to,
    assignedName: row.assigned_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    notes: row.notes,
  };
}

const SELECT = `SELECT s.id, s.project_id, j.title AS project_title, j.address AS project_address,
       c.name AS customer_name, s.assigned_to, p.name AS assigned_name,
       s.starts_at, s.ends_at, s.notes
  FROM schedule_entries s
  LEFT JOIN projects j ON j.id = s.project_id
  LEFT JOIN customers c ON c.id = j.customer_id
  LEFT JOIN people p ON p.id = s.assigned_to`;

export async function listSchedule(
  orgId: string,
  range: { from: Date; to: Date },
  filters: { assignedTo?: string; projectId?: string } = {},
): Promise<ScheduleEntry[]> {
  const conditions = ["s.org_id = $1", "s.starts_at < $2", "s.ends_at > $3"];
  const params: unknown[] = [orgId, range.to, range.from];
  if (filters.assignedTo) {
    params.push(filters.assignedTo);
    conditions.push(`s.assigned_to = $${params.length}`);
  }
  if (filters.projectId) {
    params.push(filters.projectId);
    conditions.push(`s.project_id = $${params.length}`);
  }
  const rows = await query<ScheduleRow>(
    `${SELECT} WHERE ${conditions.join(" AND ")} ORDER BY s.starts_at`,
    params,
  );
  return rows.map(toEntry);
}

export async function createScheduleEntry(input: {
  orgId: string;
  projectId: string | null;
  assignedTo: string | null;
  startsAt: Date;
  endsAt: Date;
  notes: string;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO schedule_entries (org_id, project_id, assigned_to, starts_at, ends_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.orgId, input.projectId, input.assignedTo, input.startsAt, input.endsAt, input.notes],
  );
  return row!.id;
}

export async function deleteScheduleEntry(id: string, orgId: string): Promise<void> {
  await query(`DELETE FROM schedule_entries WHERE id = $1 AND org_id = $2`, [id, orgId]);
}
