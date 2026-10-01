import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody } from "@/lib/api";
import { requireOwner } from "@/lib/api-settings";
import { removeTeammate, updateTeammateRole } from "@/lib/auth";
import { ROLES } from "@/lib/org-members";

type Context = { params: Promise<{ id: string }> };

/** PATCH { role } — owner only, and not your own role (so the workspace keeps its owner). */
export const PATCH = api(async (request: Request, { params }: Context) => {
  const session = await apiSession();
  requireOwner(session);
  const id = await idParam(params, "Person");
  if (id === session.person.id) throw new ApiError(400, "You can't change your own role.");
  const { role } = await jsonBody<{ role?: string }>(request);
  if (!role || !ROLES.includes(role)) throw new ApiError(400, "Pick a role.");
  await updateTeammateRole(session.org.id, id, role);
  return NextResponse.json({ ok: true });
});

/** DELETE → removes someone from the workspace (never an owner). */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const session = await apiSession();
  requireOwner(session);
  const id = await idParam(params, "Person");
  if (id === session.person.id) throw new ApiError(400, "Use Delete account to remove yourself.");
  await removeTeammate(session.org.id, id);
  return NextResponse.json({ ok: true });
});
