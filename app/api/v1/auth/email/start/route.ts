import { NextResponse } from "next/server";
import { api, ApiError, jsonBody } from "@/lib/api";
import { normalizeEmail, sendLoginEmail } from "@/lib/email-login";
import { originFromHeaders } from "@/lib/request-origin";

/** POST { email, timeZone? } → emails a sign-in code (and link) — the app then posts the code to /verify. */
export const POST = api(async (request: Request) => {
  const body = await jsonBody<{ email?: string; timeZone?: string }>(request);
  const email = normalizeEmail(body.email ?? "");
  if (!email) throw new ApiError(400, "Enter a valid email address.");
  const origin = (process.env.APP_URL || "").replace(/\/+$/, "") || originFromHeaders(request.headers);
  const error = await sendLoginEmail(email, origin, body.timeZone ?? "UTC");
  if (error) throw new ApiError(429, error);
  return NextResponse.json({ sent: true });
});
