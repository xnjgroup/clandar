/**
 * Projects: one property, one project — the hub every other feature (quoting,
 * scheduling, project records, tasks) hangs a record off. Scoped to one org.
 */
import { query, queryOne } from "@/lib/db";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/data";
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = `SELECT j.id, j.title, j.project_type_id, pt.name AS project_type_name, pt.icon AS project_type_icon,
       j.address, j.status, j.notes, j.created_at, j.updated_at,
       c.id AS customer_id, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
       p.id AS assigned_to, p.name AS assigned_name
  FROM projects j
  JOIN customers c ON c.id = j.customer_id
  LEFT JOIN people p ON p.id = j.assigned_to
  LEFT JOIN project_types pt ON pt.id = j.project_type_id`;

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
  createdBy: string | null;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO projects (org_id, customer_id, title, project_type_id, address, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.orgId,
      input.customerId,
      input.title,
      input.projectTypeId,
      input.address,
      input.notes,
      input.createdBy,
    ],
  );
  return row!.id;
}

export async function updateProject(
  id: string,
  orgId: string,
  input: { title: string; projectTypeId: string | null; address: string; notes: string },
): Promise<void> {
  await query(
    `UPDATE projects SET title = $3, project_type_id = $4, address = $5, notes = $6 WHERE id = $1 AND org_id = $2`,
    [id, orgId, input.title, input.projectTypeId, input.address, input.notes],
  );
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
