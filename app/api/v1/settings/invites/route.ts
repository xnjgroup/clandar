import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { requireOwner } from "@/lib/api-settings";
import { inviteTeammate } from "@/lib/auth";
import { ROLES, sendInviteEmail } from "@/lib/org-members";
import { originFromHeaders } from "@/lib/request-origin";

/** POST { email, role } → invites someone (and emails them if a Gmail connector can send) → { message }. */
export const POST = api(async (request: Request) => {
  const session = await apiSession();
  requireOwner(session);
  const body = await jsonBody<{ email?: string; role?: string }>(request);
  const email = body.email?.trim().toLowerCase() ?? "";
  const role = body.role || "crew";
  if (!email.includes("@") || email.length > 200) throw new ApiError(400, "Enter a valid email address.");
  if (!ROLES.includes(role)) throw new ApiError(400, "Pick a role.");
  await inviteTeammate(session.org.id, session.person.id, email, role);
  const sent = await sendInviteEmail({
    orgId: session.org.id,
    orgName: session.org.name,
    inviter: session.person.name || session.person.email,
    email,
    role,
    origin: originFromHeaders(request.headers),
  });
  return NextResponse.json({ message: sent.ok ? `Invited ${email} — an invitation email is on its way.` : `Invited ${email}. ${sent.why}` }, { status: 201 });
});
