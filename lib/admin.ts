/**
 * Platform admin: cross-tenant access for whoever's Google account email is
 * listed in `ADMIN_EMAILS`. Separate from an org's "owner" role — an owner
 * only ever sees their own org; an admin sees platform-wide settings (e.g.
 * the default LLM provider every org falls back to) that no org's data can
 * grant, no matter who owns it.
 */
import "server-only";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { requireSession, type SessionInfo } from "@/lib/auth";

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(email.trim().toLowerCase());
}

/** The DAL primitive for /admin and its actions — redirects non-admins to /overview. */
export async function requireAdmin(): Promise<SessionInfo> {
  const session = await requireSession();
  if (!isAdminEmail(session.person.email)) redirect("/overview");
  return session;
}

export type OrgSummary = { id: string; name: string; memberCount: number; onboarded: boolean; createdAt: Date };

/** Cross-tenant — every organization on the platform, for the admin overview. */
export async function listAllOrganizations(): Promise<OrgSummary[]> {
  const rows = await query<{ id: string; name: string; member_count: string; onboarded: boolean; created_at: Date }>(
    `SELECT o.id, o.name, o.onboarded, o.created_at,
            (SELECT count(*) FROM people p WHERE p.org_id = o.id)::text AS member_count
       FROM organizations o
      ORDER BY o.created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    memberCount: Number(r.member_count),
    onboarded: r.onboarded,
    createdAt: r.created_at,
  }));
}
