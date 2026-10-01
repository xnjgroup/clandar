import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { requireOwner } from "@/lib/api-settings";
import { ASSISTANT_NAME_PATTERN, listPendingInvites, listTeam, updateAssistantName, updateOrgName } from "@/lib/auth";
import { ROLES } from "@/lib/org-members";

/** GET → { org: { name, assistantName }, role, canManage, people, invites, roles }. */
export const GET = api(async () => {
  const session = await apiSession();
  const canManage = session.person.role === "owner";
  const [people, invites] = await Promise.all([listTeam(session.org.id), canManage ? listPendingInvites(session.org.id) : []]);
  return NextResponse.json({
    org: { name: session.org.name, assistantName: session.org.assistantName },
    role: session.person.role,
    canManage,
    people,
    invites,
    roles: ROLES,
  });
});

/** PATCH { name?, assistantName? } — owner only. */
export const PATCH = api(async (request: Request) => {
  const session = await apiSession();
  requireOwner(session);
  const body = await jsonBody<{ name?: string; assistantName?: string }>(request);
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name || name.length > 80) throw new ApiError(400, "Enter a name (up to 80 characters).");
    await updateOrgName(session.org.id, name);
  }
  if (body.assistantName !== undefined) {
    const name = body.assistantName.trim();
    if (!ASSISTANT_NAME_PATTERN.test(name)) throw new ApiError(400, "Use one word — letters and numbers only, up to 10 characters.");
    await updateAssistantName(session.org.id, name);
  }
  return NextResponse.json({ ok: true });
});
