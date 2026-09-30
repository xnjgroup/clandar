"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { TimeZoneField } from "@/components/time-zone-field";
import { sendEmailLogin, verifyEmailCode, type EmailLoginState } from "./actions";

const inputClass =
  "h-[42px] w-full rounded-[12px] border border-line bg-surface px-3 text-[13.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";
const primaryButton =
  "h-[42px] w-full cursor-pointer rounded-[12px] bg-ink text-[13.5px] font-semibold text-bg disabled:opacity-50";
const outlineButton =
  "flex h-[42px] w-full items-center justify-center gap-[9px] rounded-[12px] border border-line bg-surface text-[13.5px] font-semibold text-ink hover:bg-bg";
const inlineLink = "cursor-pointer text-ink underline underline-offset-2 disabled:opacity-50";

/**
 * The sign-in card's contents. First: Google / Apple / OR / email (each only when configured).
 * After "Continue with email" the whole card becomes "check your email" — the link, resend,
 * change address, and the code from the email as a fallback. "Change email address" starts over.
 */
export function LoginOptions(props: { google: boolean; apple: boolean; email: boolean }) {
  // Re-keyed by "Change email address", which is the simplest way back to a fresh first step.
  const [attempt, setAttempt] = useState(0);
  return <LoginSteps key={attempt} {...props} onRestart={() => setAttempt((n) => n + 1)} />;
}

function LoginSteps({
  google,
  apple,
  email,
  onRestart,
}: {
  google: boolean;
  apple: boolean;
  email: boolean;
  onRestart: () => void;
}) {
  const [sent, sendAction, sending] = useActionState<EmailLoginState, FormData>(sendEmailLogin, {});
  const [verified, verifyAction, verifying] = useActionState<EmailLoginState, FormData>(verifyEmailCode, {});
  const sentTo = verified.sentTo ?? sent.sentTo;

  if (sentTo) {
    return (
      <div className="flex w-full flex-col gap-[14px] px-[4px] py-[6px] text-center text-[13px] leading-[1.55] text-body-soft">
        <p className="m-0">
          To continue, click the link sent to
          <br />
          <span className="font-semibold text-ink">{sentTo}</span>
        </p>
        <form action={sendAction} className="m-0">
          <input type="hidden" name="email" value={sentTo} />
          <input type="hidden" name="resend" value="1" />
          <TimeZoneField />
          Not seeing the email in your inbox?{" "}
          <button type="submit" disabled={sending} className={inlineLink}>
            {sending ? "Sending…" : "Try sending again"}
          </button>
          .<br />
          Wrong email?{" "}
          <button type="button" onClick={onRestart} className={inlineLink}>
            Change email address
          </button>
        </form>
        {sent.error ? <span className="text-[12px] text-bad-fg">{sent.error}</span> : null}

        <form action={verifyAction} className="mt-[8px] flex w-full flex-col gap-[10px]">
          <p className="m-0">Opened the email on another device? Enter the code from it here.</p>
          <input type="hidden" name="email" value={sentTo} />
          <input
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="Enter verification code"
            aria-label="Verification code"
            className={`${inputClass} text-center font-mono tracking-[0.2em] placeholder:font-sans placeholder:tracking-normal`}
          />
          <button type="submit" disabled={verifying} className={primaryButton}>
            {verifying ? "Checking…" : "Verify email address"}
          </button>
          {verified.error ? <span className="text-[12px] text-bad-fg">{verified.error}</span> : null}
        </form>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-[10px]">
      {google ? (
        <a href="/api/auth/google" className={outlineButton}>
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z" />
            <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
            <path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z" />
            <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z" />
          </svg>
          Continue with Google
        </a>
      ) : null}
      {apple ? (
        <a href="/api/auth/apple" className={outlineButton}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M16.37 12.62c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.54 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.52ZM14.2 6.16c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22Z" />
          </svg>
          Continue with Apple
        </a>
      ) : null}
      {email && (google || apple) ? (
        <div className="my-[2px] flex items-center gap-[10px] text-[10.5px] font-medium tracking-[0.08em] text-faint">
          <span className="h-px flex-1 bg-line" />
          OR
          <span className="h-px flex-1 bg-line" />
        </div>
      ) : null}
      {email ? (
        <form action={sendAction} className="flex w-full flex-col gap-[10px]">
          {/* The browser's zone, for the timestamp in the email's subject. */}
          <TimeZoneField />
          <input
            id="login-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="Enter your email"
            aria-label="Email address"
            className={inputClass}
          />
          <button type="submit" disabled={sending} className={primaryButton}>
            {sending ? "Sending…" : "Continue with email"}
          </button>
          {sent.error ? <span className="text-center text-[12px] text-bad-fg">{sent.error}</span> : null}
        </form>
      ) : null}
      {!google && !apple && !email ? (
        <p className="m-0 text-center text-[12.5px] text-bad-fg">
          No sign-in method is configured yet — set GOOGLE_CLIENT_ID/SECRET, APPLE_CLIENT_ID or SMTP_URL.
        </p>
      ) : null}
      <p className="m-0 mt-[2px] text-center text-[10.5px] leading-[1.6] text-faint">
        First time? Signing in creates your company&rsquo;s workspace. Joining a team? Use the email your owner
        invited. By continuing you agree to the{" "}
        <Link href="/terms" className="underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
