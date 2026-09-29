/**
 * Jobs: one property, one project — the hub every other feature (quoting,
 * scheduling, project records, tasks) hangs a record off. Scoped to one org.
 */
import { query, queryOne } from "@/lib/db";
import { JOB_STATUSES, TRADES, type JobStatus, type Trade } from "@/lib/data";
import { deleteUpload } from "@/lib/storage";

// Re-exported so existing `from "@/lib/jobs"` imports keep working — the data
// itself lives in lib/data.ts because it's plain presentation config that a
// client component (e.g. the new-job form) needs too, and lib/jobs.ts pulls
// in `@/lib/db` (Node-only `pg`), which can never reach a client bundle.
export { JOB_STATUSES, TRADES, type JobStatus, type Trade } from "@/lib/data";

export type Job = {
  id: string;
  title: string;
  trade: Trade;
  address: string;
  status: JobStatus;
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

type JobRow = {
  id: string;
  title: string;
  trade: Trade;
  address: string;
  status: JobStatus;
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

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    title: row.title,
    trade: row.trade,
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

const SELECT = `SELECT j.id, j.title, j.trade, j.address, j.status, j.notes, j.created_at, j.updated_at,
       c.id AS customer_id, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
       p.id AS assigned_to, p.name AS assigned_name
  FROM jobs j
  JOIN customers c ON c.id = j.customer_id
  LEFT JOIN people p ON p.id = j.assigned_to`;

export async function listJobs(
  orgId: string,
  filters: { status?: JobStatus; customerId?: string; assignedTo?: string } = {},
): Promise<Job[]> {
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
  const rows = await query<JobRow>(
    `${SELECT} WHERE ${conditions.join(" AND ")} ORDER BY j.created_at DESC`,
    params,
  );
  return rows.map(toJob);
}

export async function getJob(id: string, orgId: string): Promise<Job | null> {
  const row = await queryOne<JobRow>(`${SELECT} WHERE j.id = $1 AND j.org_id = $2`, [id, orgId]);
  return row ? toJob(row) : null;
}

export async function jobCountsByStatus(orgId: string): Promise<Record<JobStatus, number>> {
  const rows = await query<{ status: JobStatus; count: string }>(
    `SELECT status, count(*)::text AS count FROM jobs WHERE org_id = $1 GROUP BY status`,
    [orgId],
  );
  const counts = Object.fromEntries(JOB_STATUSES.map((s) => [s.id, 0])) as Record<JobStatus, number>;
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}

export async function createJob(input: {
  orgId: string;
  customerId: string;
  title: string;
  trade: Trade;
  address: string;
  notes: string;
  createdBy: string | null;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO jobs (org_id, customer_id, title, trade, address, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.orgId, input.customerId, input.title, input.trade, input.address, input.notes, input.createdBy],
  );
  return row!.id;
}

export async function updateJob(
  id: string,
  orgId: string,
  input: { title: string; trade: Trade; address: string; notes: string },
): Promise<void> {
  await query(
    `UPDATE jobs SET title = $3, trade = $4, address = $5, notes = $6 WHERE id = $1 AND org_id = $2`,
    [id, orgId, input.title, input.trade, input.address, input.notes],
  );
}

export async function setJobStatus(id: string, orgId: string, status: JobStatus): Promise<void> {
  await query(`UPDATE jobs SET status = $3 WHERE id = $1 AND org_id = $2`, [id, orgId, status]);
}

export async function assignJob(id: string, orgId: string, assignedTo: string | null): Promise<void> {
  await query(`UPDATE jobs SET assigned_to = $3 WHERE id = $1 AND org_id = $2`, [id, orgId, assignedTo]);
}

/**
 * Deleting a job cascades every DB row hanging off it (photos, files,
 * estimates, schedule entries, tasks) — but the actual bytes on disk for its
 * photos and files live outside Postgres (lib/storage.ts) and have to be
 * cleaned up first, or they'd be orphaned forever.
 */
export async function deleteJob(id: string, orgId: string): Promise<void> {
  const paths = await query<{ file_path: string }>(
    `SELECT file_path FROM job_photos WHERE job_id = $1
     UNION ALL
     SELECT file_path FROM job_files WHERE job_id = $1`,
    [id],
  );
  await query(`DELETE FROM jobs WHERE id = $1 AND org_id = $2`, [id, orgId]);
  await Promise.all(paths.map((p) => deleteUpload(p.file_path)));
}

export function tradeLabel(trade: Trade): string {
  return TRADES.find((t) => t.id === trade)?.label ?? trade;
}
