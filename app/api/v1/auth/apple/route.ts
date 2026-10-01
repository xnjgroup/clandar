import { NextResponse } from "next/server";
import { api, ApiError, jsonBody } from "@/lib/api";
import { signInForApp } from "@/lib/auth";
import { verifyAppleIdentityToken } from "@/lib/native-auth";

/** POST { identityToken, fullName? } (from Sign in with Apple on iOS) → { token, expiresAt }. */
export const POST = api(async (request: Request) => {
  const { identityToken, fullName } = await jsonBody<{ identityToken?: string; fullName?: string }>(request);
  if (!identityToken) throw new ApiError(400, "Missing identityToken.");
  const identity = await verifyAppleIdentityToken(identityToken, fullName).catch((e: Error) => {
    throw new ApiError(401, e.message);
  });
  return NextResponse.json(await signInForApp(identity));
});
