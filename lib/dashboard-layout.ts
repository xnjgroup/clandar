/**
 * Saved dashboard layouts (see components/dashboard-grid.tsx). A saved layout
 * is merged with the page's defaults on load: widgets added since keep their
 * default spot, widgets that no longer exist are dropped, and sizes are clamped
 * to each widget's minimums.
 */
import { query, queryOne } from "@/lib/db";

export type Placement = { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number };

const COLS = 12;

function valid(p: unknown): p is Placement {
  const v = p as Placement;
  return (
    typeof v?.i === "string" &&
    [v.x, v.y, v.w, v.h].every((n) => Number.isInteger(n) && n >= 0) &&
    v.w >= 1 &&
    v.h >= 1 &&
    v.x + v.w <= COLS
  );
}

export async function getDashboardLayout(personId: string, page: string, defaults: Placement[]): Promise<Placement[]> {
  const row = await queryOne<{ layout: unknown }>(
    `SELECT layout FROM dashboard_layouts WHERE person_id = $1 AND page = $2`,
    [personId, page],
  );
  const saved = Array.isArray(row?.layout) ? (row!.layout as unknown[]).filter(valid) : [];
  return defaults.map((d) => {
    const s = saved.find((p) => p.i === d.i);
    return s
      ? { ...d, x: s.x, y: s.y, w: Math.max(s.w, d.minW ?? 1), h: Math.max(s.h, d.minH ?? 1) }
      : d;
  });
}

export async function saveDashboardLayout(personId: string, page: string, layout: Placement[]): Promise<void> {
  const clean = layout.filter(valid).map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
  await query(
    `INSERT INTO dashboard_layouts (person_id, page, layout, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (person_id, page) DO UPDATE SET layout = $3, updated_at = now()`,
    [personId, page, JSON.stringify(clean)],
  );
}
