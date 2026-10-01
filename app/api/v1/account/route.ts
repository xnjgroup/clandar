import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { deleteOrganization, removeTeammate } from "@/lib/auth";

/**
 * DELETE { confirm } — deletes your account (App Store rule: an app you can sign up in must let you delete
 * the account in it). An owner deletes the whole company and everything in it, confirmed by typing the
 * company's name; anyone else leaves and their account is deleted, confirmed by typing their email.
 * Their sessions go with the person row, so the app is signed out.
 */
export const DELETE = api(async (request: Request) => {
  const session = await apiSession();
  const { confirm } = await jsonBody<{ confirm?: string }>(request);
  if (session.person.role === "owner") {
    if (confirm?.trim() !== session.org.name) throw new ApiError(400, "Type the company name exactly to confirm.");
    await deleteOrganization(session.org.id);
  } else {
    if (confirm?.trim().toLowerCase() !== session.person.email.toLowerCase()) throw new ApiError(400, "Type your email exactly to confirm.");
    await removeTeammate(session.org.id, session.person.id);
  }
  return NextResponse.json({ ok: true });
});
