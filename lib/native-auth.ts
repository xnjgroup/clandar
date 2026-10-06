/**
 * Sign-in from the iOS app: it signs in with Google / Apple natively and sends the provider's ID
 * token here; we verify it against the provider's published keys, issuer and audience (our own
 * iOS client — a token minted for another app is rejected), then resolve the account like the web
 * does (lib/auth.ts signInForApp).
 *
 *   GOOGLE_IOS_CLIENT_ID  the iOS OAuth client id from Google Cloud (comma-separate several)
 *   APPLE_BUNDLE_ID       the app's bundle id(s), current first — e.g. com.clandar.mobile,com.clandar.app (Apple's audience for app tokens; the first is also the push topic)
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { LoginIdentity } from "@/lib/auth";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

export async function verifyGoogleIdToken(idToken: string): Promise<LoginIdentity> {
  const audience = list(process.env.GOOGLE_IOS_CLIENT_ID);
  if (audience.length === 0) throw new Error("Google sign-in for the app isn't configured (GOOGLE_IOS_CLIENT_ID).");
  const { payload } = await jwtVerify(idToken, googleKeys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience,
  }).catch(() => {
    throw new Error("Couldn't verify the Google sign-in.");
  });
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  if (!payload.sub || !email || payload.email_verified !== true) throw new Error("Google didn't share a verified email.");
  return {
    provider: "google",
    sub: payload.sub,
    email,
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}

export async function verifyAppleIdentityToken(identityToken: string, fullName?: string | null): Promise<LoginIdentity> {
  const audience = list(process.env.APPLE_BUNDLE_ID || "com.clandar.mobile,com.clandar.app");
  const { payload } = await jwtVerify(identityToken, appleKeys, { issuer: "https://appleid.apple.com", audience }).catch(
    () => {
      throw new Error("Couldn't verify the Apple sign-in.");
    },
  );
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  const verified = payload.email_verified === true || payload.email_verified === "true";
  if (!payload.sub || !email || !verified) throw new Error("Apple didn't share a verified email.");
  // Apple gives the name only to the app, only on the very first sign-in — it passes it along.
  return { provider: "apple", sub: payload.sub, email, name: fullName?.trim() || null };
}
