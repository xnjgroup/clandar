import { NextResponse } from "next/server";
import { api, ApiError, jsonBody } from "@/lib/api";
import { signInForApp } from "@/lib/auth";
import { consumeLoginCode, normalizeEmail } from "@/lib/email-login";

/** POST { email, code } → { token, expiresAt } — a session token for the app's Keychain. */
export const POST = api(async (request: Request) => {
  const body = await jsonBody<{ email?: string; code?: string }>(request);
  const email = normalizeEmail(body.email ?? "");
  if (!email) throw new ApiError(400, "Enter a valid email address.");
  const result = await consumeLoginCode(email, body.code ?? "");
  if (result !== true) throw new ApiError(401, result);
  return NextResponse.json(await signInForApp({ provider: "email", email }));
});
