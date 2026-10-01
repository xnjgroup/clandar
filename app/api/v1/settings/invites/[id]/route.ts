import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam } from "@/lib/api";
import { requireOwner } from "@/lib/api-settings";
import { revokeInvite } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { sendInviteEmail } from "@/lib/org-members";
import { originFromHeaders } from "@/lib/request-origin";

type Context = { params: Promise<{ id: string }> };

/** POST → sends the invitation email again → { message }. */
export const POST = api(async (request: Request, { params }: Context) => {
  const session = await apiSession();
  requireOwner(session);
  const id = await idParam(params, "Invite");
  const invite = await queryOne<{ email: string; role: string }>(
    `SELECT email, role FROM org_invites WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL`,
    [id, session.org.id],
  );
  if (!invite) throw new ApiError(404, "That invite no longer exists.");
  const sent = await sendInviteEmail({
    orgId: session.org.id,
    orgName: session.org.name,
    inviter: session.person.name || session.person.email,
    email: invite.email,
    role: invite.role,
    origin: originFromHeaders(request.headers),
  });
  if (!sent.ok) throw new ApiError(409, sent.why);
  await query(`UPDATE org_invites SET created_at = now() WHERE id = $1`, [id]);
  return NextResponse.json({ message: `Sent again to ${invite.email}.` });
});

/** DELETE → cancels the invite. */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const session = await apiSession();
  requireOwner(session);
  await revokeInvite(session.org.id, await idParam(params, "Invite"));
  return NextResponse.json({ ok: true });
});
