/**
 * "Continue with Apple" on the web (Sign in with Apple JS flow, without the JS):
 * redirect to Apple, which POSTs back (response_mode=form_post) an ID token —
 * verified here against Apple's published keys, issuer, audience and a
 * one-time nonce — plus, on the very first sign-in only, the person's name.
 * Only the ID token is used, so no client secret / private key is needed.
 *
 * Setup (Apple Developer → Identifiers): a Services ID with Sign in with Apple
 * enabled, clandar.com as a domain and https://clandar.com/api/auth/apple/callback
 * as a return URL; its identifier goes in APPLE_CLIENT_ID. Apple requires
 * HTTPS return URLs, so this can't be tried on http://localhost.
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { signInWithIdentity } from "@/lib/auth";

const STATE_COOKIE = "clandar_apple_state";
const NONCE_COOKIE = "clandar_apple_nonce";
const APPLE_ISSUER = "https://appleid.apple.com";
const appleKeys = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

export function appleLoginConfigured(): boolean {
  return Boolean(process.env.APPLE_CLIENT_ID);
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const callbackUrl = (origin: string) => `${origin}/api/auth/apple/callback`;

/** The Apple authorize URL; state + nonce go in short-lived cookies checked on the way back. */
export async function startAppleLogin(origin: string): Promise<string> {
  const clientId = process.env.APPLE_CLIENT_ID;
  if (!clientId) throw new Error("Sign in with Apple isn't configured (APPLE_CLIENT_ID).");
  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  // Apple returns with a cross-site POST, which only carries SameSite=None cookies.
  const jar = await cookies();
  const options = { httpOnly: true, secure: true, sameSite: "none" as const, maxAge: 600, path: "/" };
  jar.set(STATE_COOKIE, state, options);
  jar.set(NONCE_COOKIE, nonce, options);

  const url = new URL(`${APPLE_ISSUER}/auth/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl(origin));
  url.searchParams.set("response_type", "code id_token");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("scope", "name email");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", sha256(nonce));
  return url.toString();
}

/** Verifies Apple's form post and signs the person in. Throws a message fit to show on /login. */
export async function completeAppleLogin(form: FormData): Promise<void> {
  const clientId = process.env.APPLE_CLIENT_ID;
  if (!clientId) throw new Error("Sign in with Apple isn't configured.");

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  const nonce = jar.get(NONCE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  jar.delete(NONCE_COOKIE);

  const error = form.get("error");
  if (typeof error === "string") {
    throw new Error(error === "user_cancelled_authorize" ? "Sign-in was cancelled." : `Apple returned "${error}".`);
  }
  if (!expectedState || form.get("state") !== expectedState || !nonce) {
    throw new Error("That sign-in link expired — try again.");
  }
  const idToken = form.get("id_token");
  if (typeof idToken !== "string") throw new Error("Apple did not return an identity token.");

  const { payload } = await jwtVerify(idToken, appleKeys, { issuer: APPLE_ISSUER, audience: clientId }).catch(() => {
    throw new Error("Couldn't verify the Apple sign-in — try again.");
  });
  if (payload.nonce !== sha256(nonce)) throw new Error("That sign-in link expired — try again.");
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  const verified = payload.email_verified === true || payload.email_verified === "true";
  if (!payload.sub || !email || !verified) throw new Error("Apple didn't share a verified email address.");

  // Apple sends the name only the first time someone signs in to Clandar.
  let name: string | null = null;
  const user = form.get("user");
  if (typeof user === "string") {
    try {
      const parsed = JSON.parse(user) as { name?: { firstName?: string; lastName?: string } };
      name = [parsed.name?.firstName, parsed.name?.lastName].filter(Boolean).join(" ") || null;
    } catch {
      // No name, then — the email stands in.
    }
  }

  await signInWithIdentity({ provider: "apple", sub: payload.sub, email, name });
}
