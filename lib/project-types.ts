/**
 * Project types: what "kind" of project a business runs, entirely
 * user-managed per org — nothing is hardcoded to one industry. A new org's
 * owner picks a company type at /onboarding, which seeds a starter list from
 * `COMPANY_TYPES` below; from then on it's just their own editable list
 * (rename, add, remove) — the company type itself is only ever used once, to
 * seed that starting point.
 */
import type { IconName } from "@/components/icons";
import { query, queryOne } from "@/lib/db";
import { COMPANY_TYPES } from "@/lib/data";

// Re-exported so existing `from "@/lib/project-types"` imports keep working —
// the data itself lives in lib/data.ts because it's plain presentation config
// that the client-side onboarding form needs too, and lib/project-types.ts
// pulls in `@/lib/db` (Node-only `pg`), which can never reach a client bundle.
export { COMPANY_TYPES, type CompanyType } from "@/lib/data";

export type ProjectType = { id: string; name: string; icon: IconName; sortOrder: number };

export async function listProjectTypes(orgId: string): Promise<ProjectType[]> {
  const rows = await query<{ id: string; name: string; icon: string; sort_order: number }>(
    `SELECT id, name, icon, sort_order FROM project_types WHERE org_id = $1 ORDER BY sort_order, name`,
    [orgId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, icon: r.icon as IconName, sortOrder: r.sort_order }));
}

export async function createProjectType(orgId: string, name: string, icon: string): Promise<string> {
  const row = await queryOne<{ id: string; max_sort: number | null }>(
    `INSERT INTO project_types (org_id, name, icon, sort_order)
     VALUES ($1, $2, $3, (SELECT coalesce(max(sort_order), -1) + 1 FROM project_types WHERE org_id = $1))
     RETURNING id, (SELECT max(sort_order) FROM project_types WHERE org_id = $1) AS max_sort`,
    [orgId, name, icon],
  );
  return row!.id;
}

export async function renameProjectType(id: string, orgId: string, name: string, icon: string): Promise<void> {
  await query(`UPDATE project_types SET name = $3, icon = $4 WHERE id = $1 AND org_id = $2`, [
    id,
    orgId,
    name,
    icon,
  ]);
}

/** Projects using this type keep working — `project_type_id` just goes null (ON DELETE SET NULL). */
export async function deleteProjectType(id: string, orgId: string): Promise<void> {
  await query(`DELETE FROM project_types WHERE id = $1 AND org_id = $2`, [id, orgId]);
}

/** Called once, when a new org's owner finishes /onboarding. */
export async function seedProjectTypes(orgId: string, companyTypeId: string): Promise<void> {
  const template = COMPANY_TYPES.find((c) => c.id === companyTypeId) ?? COMPANY_TYPES.at(-1)!;
  let sortOrder = 0;
  for (const t of template.projectTypes) {
    await query(
      `INSERT INTO project_types (org_id, name, icon, sort_order) VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, lower(name)) DO NOTHING`,
      [orgId, t.name, t.icon, sortOrder++],
    );
  }
}
