"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInWithIdentity, takeAfterSignIn } from "@/lib/auth";
import { consumeLoginCode, consumeLoginLink, normalizeEmail, sendLoginEmail } from "@/lib/email-login";
import { originFromHeaders } from "@/lib/request-origin";

export type EmailLoginState = { sentTo?: string; error?: string };

/** "Continue with email": emails a sign-in link + 6-digit code. */
export async function sendEmailLogin(_prev: EmailLoginState, form: FormData): Promise<EmailLoginState> {
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!email) return { error: "Enter a valid email address." };
  // The link's site comes from APP_URL when set — never trust a request's Host header for a link that
  // carries a sign-in token (a forged header would point the email at someone else's site).
  const origin = (process.env.APP_URL || "").replace(/\/+$/, "") || originFromHeaders(await headers());
  try {
    const error = await sendLoginEmail(email, origin, String(form.get("timeZone") ?? ""));
    if (error) return { error, sentTo: form.get("resend") ? email : undefined };
  } catch (error) {
    // The person sees a plain message; the real reason (bad SMTP login, unverified sender …) goes to the log.
    console.error("[email-login] send failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't send the email — try again in a moment." };
  }
  return { sentTo: email };
}

/** The 6-digit code from that email. */
export async function verifyEmailCode(_prev: EmailLoginState, form: FormData): Promise<EmailLoginState> {
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!email) return { error: "Start again with your email address." };
  const result = await consumeLoginCode(email, String(form.get("code") ?? ""));
  if (result !== true) return { sentTo: email, error: result };
  await signInWithIdentity({ provider: "email", email });
  redirect(await takeAfterSignIn());
}

/** The confirm page's button for a sign-in link. */
export async function confirmEmailLink(form: FormData) {
  const email = await consumeLoginLink(String(form.get("token") ?? ""));
  if (!email) redirect(`/login?error=${encodeURIComponent("That sign-in link has expired or was already used — send a new one.")}`);
  await signInWithIdentity({ provider: "email", email });
  redirect(await takeAfterSignIn());
}
