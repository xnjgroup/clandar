import { NextResponse } from "next/server";
import { api, ApiError, jsonBody } from "@/lib/api";
import { signInForApp } from "@/lib/auth";
import { verifyGoogleIdToken } from "@/lib/native-auth";

/** POST { idToken } (from Google Sign-In on iOS) → { token, expiresAt }. */
export const POST = api(async (request: Request) => {
  const { idToken } = await jsonBody<{ idToken?: string }>(request);
  if (!idToken) throw new ApiError(400, "Missing idToken.");
  const identity = await verifyGoogleIdToken(idToken).catch((e: Error) => {
    throw new ApiError(401, e.message);
  });
  return NextResponse.json(await signInForApp(identity));
});
