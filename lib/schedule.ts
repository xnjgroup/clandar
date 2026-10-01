/**
 * Scheduling: one calendar entry is a time window — "what's happening"
 * (`notes`), optionally on a project and assigned to a crew member. The daily "route" (lib/data doesn't need this — see
 * app/(dashboard)/schedule/page.tsx) is just this list filtered to one day
 * and person, ordered by start time.
 */
import { query, queryOne } from "@/lib/db";
import { geocode, geocodePause } from "@/lib/geocode";

export type ScheduleEntry = {
  id: string;
  projectId: string | null;
  projectTitle: string | null;
  projectAddress: string | null;
  /** The project's type and its icon (components/icons.tsx names) — the app shows it as a coloured tile. */
  projectTypeId: string | null;
  projectTypeIcon: string | null;
  customerName: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  startsAt: Date;
  endsAt: Date;
  notes: string;
  /** Where it happens; empty means the project's address. */
  location: string;
  lat: number | null;
  lng: number | null;
};

type ScheduleRow = {
  id: string;
  project_id: string | null;
  project_title: string | null;
  project_address: string | null;
  project_type_id: string | null;
  project_type_icon: string | null;
  customer_name: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  starts_at: Date;
  ends_at: Date;
  notes: string;
  location: string;
  lat: number | null;
  lng: number | null;
};

function toEntry(row: ScheduleRow): ScheduleEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    projectTitle: row.project_title,
    projectAddress: row.project_address,
    projectTypeId: row.project_type_id,
    projectTypeIcon: row.project_type_icon,
    customerName: row.customer_name,
    assignedTo: row.assigned_to,
    assignedName: row.assigned_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    notes: row.notes,
    location: row.location,
    lat: row.lat,
    lng: row.lng,
  };
}

const SELECT = `SELECT s.id, s.project_id, j.title AS project_title, j.address AS project_address,
       j.project_type_id, pt.icon AS project_type_icon,
       c.name AS customer_name, s.assigned_to, p.name AS assigned_name,
       s.starts_at, s.ends_at, s.notes, s.location, s.lat, s.lng
  FROM schedule_entries s
  LEFT JOIN projects j ON j.id = s.project_id
  LEFT JOIN project_types pt ON pt.id = j.project_type_id
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
  location?: string;
}): Promise<string> {
  const location = input.location?.trim() ?? "";
  // Look the place up now (it's one request) so the map has it straight away.
  const point = location ? await geocode(location) : null;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO schedule_entries (org_id, project_id, assigned_to, starts_at, ends_at, notes, location, lat, lng)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [input.orgId, input.projectId, input.assignedTo, input.startsAt, input.endsAt, input.notes, location, point?.lat ?? null, point?.lng ?? null],
  );
  return row!.id;
}

/**
 * Fills in coordinates for entries that have none yet — their own location, or
 * their project's address when they don't have one. Meant for after() on a page
 * that shows the map: at most `limit` lookups, one a second, so the next load
 * has them. Places that can't be found stay null and are retried next time.
 */
export async function locateScheduleEntries(orgId: string, entries: ScheduleEntry[], limit = 5): Promise<void> {
  const found = new Map<string, Awaited<ReturnType<typeof geocode>>>();
  let lookups = 0;
  for (const entry of entries) {
    if (entry.lat !== null) continue;
    const place = (entry.location || entry.projectAddress || "").trim();
    if (!place) continue;
    if (!found.has(place)) {
      if (lookups >= limit) break;
      if (lookups > 0) await geocodePause();
      lookups++;
      found.set(place, await geocode(place));
    }
    const point = found.get(place);
    if (point) {
      await query(`UPDATE schedule_entries SET lat = $1, lng = $2 WHERE id = $3 AND org_id = $4`, [point.lat, point.lng, entry.id, orgId]);
    }
  }
}

export async function getScheduleEntry(id: string, orgId: string): Promise<ScheduleEntry | null> {
  const row = await queryOne<ScheduleRow>(`${SELECT} WHERE s.id = $1 AND s.org_id = $2`, [id, orgId]);
  return row ? toEntry(row) : null;
}

/**
 * Changes an entry; fields left undefined stay as they are. A new location is
 * looked up again (an empty one falls back to the project's address, filled in
 * by locateScheduleEntries); so is a changed project when there's no location.
 */
export async function updateScheduleEntry(
  id: string,
  orgId: string,
  changes: {
    projectId?: string | null;
    assignedTo?: string | null;
    startsAt?: Date;
    endsAt?: Date;
    notes?: string;
    location?: string;
  },
): Promise<boolean> {
  const current = await getScheduleEntry(id, orgId);
  if (!current) return false;
  const location = changes.location === undefined ? current.location : changes.location.trim();
  const projectId = changes.projectId === undefined ? current.projectId : changes.projectId;
  let lat = current.lat;
  let lng = current.lng;
  if (location !== current.location || (!location && projectId !== current.projectId)) {
    const point = location ? await geocode(location) : null;
    lat = point?.lat ?? null;
    lng = point?.lng ?? null;
  }
  await query(
    `UPDATE schedule_entries
        SET project_id = $3, assigned_to = $4, starts_at = $5, ends_at = $6, notes = $7, location = $8, lat = $9, lng = $10
      WHERE id = $1 AND org_id = $2`,
    [
      id,
      orgId,
      projectId,
      changes.assignedTo === undefined ? current.assignedTo : changes.assignedTo,
      changes.startsAt ?? current.startsAt,
      changes.endsAt ?? current.endsAt,
      changes.notes ?? current.notes,
      location,
      lat,
      lng,
    ],
  );
  return true;
}

export async function deleteScheduleEntry(id: string, orgId: string): Promise<void> {
  await query(`DELETE FROM schedule_entries WHERE id = $1 AND org_id = $2`, [id, orgId]);
}
