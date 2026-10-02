import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { googleOAuthConfigured, isGoogleService, startGoogleAuth } from "@/lib/connectors";
import { originFromHeaders } from "@/lib/request-origin";

/**
 * POST { service: "google_gmail" | "google_calendar" } → { signInUrl }: Google's consent page for
 * another account. Open it in the sign-in sheet; it comes back to clandar://connectors.
 */
export const POST = api(async (request: Request) => {
  const session = await apiSession();
  const { service } = await jsonBody<{ service?: string }>(request);
  if (!service || !isGoogleService(service)) throw new ApiError(400, "Pick Gmail or Google Calendar.");
  if (!googleOAuthConfigured()) throw new ApiError(503, "Google sign-in isn't set up on this server.");
  const signInUrl = await startGoogleAuth(service, session.org.id, session.person.id, originFromHeaders(request.headers), true);
  return NextResponse.json({ signInUrl });
});
