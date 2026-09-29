/**
 * The org's company header for customer-facing email (estimates). Stored as
 * JSON on the organization; with nothing saved yet, it starts from the org's
 * name so the first send already has a sensible header.
 */
import { query, queryOne } from "@/lib/db";
import { EMPTY_LETTERHEAD, type Letterhead } from "@/lib/estimate-email";

const FIELDS = Object.keys(EMPTY_LETTERHEAD) as (keyof Letterhead)[];

/** Keeps only known fields, as trimmed strings with a sane length. */
export function cleanLetterhead(raw: Partial<Record<keyof Letterhead, unknown>>): Letterhead {
  const out = { ...EMPTY_LETTERHEAD };
  for (const key of FIELDS) {
    const value = raw[key];
    out[key] = typeof value === "string" ? value.trim().slice(0, 200) : "";
  }
  return out;
}

export async function getLetterhead(orgId: string): Promise<Letterhead> {
  const row = await queryOne<{ name: string; letterhead: Partial<Letterhead> | null }>(
    `SELECT name, letterhead FROM organizations WHERE id = $1`,
    [orgId],
  );
  const saved = cleanLetterhead(row?.letterhead ?? {});
  return { ...saved, companyName: saved.companyName || row?.name || "" };
}

export async function saveLetterhead(orgId: string, letterhead: Letterhead): Promise<void> {
  await query(`UPDATE organizations SET letterhead = $2 WHERE id = $1`, [orgId, JSON.stringify(letterhead)]);
}
