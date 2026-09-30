"use client";

import { useActionState } from "react";
import { sendEmailLogin, verifyEmailCode, type EmailLoginState } from "./actions";

const inputClass =
  "h-[42px] w-full rounded-[12px] border border-line bg-surface px-3 text-[13.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";
const primaryButton =
  "h-[42px] w-full cursor-pointer rounded-[12px] bg-ink text-[13.5px] font-semibold text-bg disabled:opacity-50";

/**
 * "Continue with email": step 1 sends a sign-in link + code; step 2 takes the
 * code (the link in the email works too, on whichever device opens it).
 */
export function EmailLogin() {
  const [sent, sendAction, sending] = useActionState<EmailLoginState, FormData>(sendEmailLogin, {});
  const [verified, verifyAction, verifying] = useActionState<EmailLoginState, FormData>(verifyEmailCode, {});
  const email = verified.sentTo ?? sent.sentTo;

  if (!email) {
    return (
      <form action={sendAction} className="flex w-full flex-col gap-[10px]">
        <input
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
        {sent.error ? <span className="text-[12px] text-bad-fg">{sent.error}</span> : null}
      </form>
    );
  }

  return (
    <div className="flex w-full flex-col gap-[10px]">
      <p className="m-0 text-center text-[12.5px] leading-[1.55] text-body">
        We sent a sign-in link and code to <span className="font-semibold">{email}</span>. Open the link, or enter the
        code here.
      </p>
      <form action={verifyAction} className="flex w-full flex-col gap-[10px]">
        <input type="hidden" name="email" value={email} />
        <input
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="6-digit code"
          aria-label="6-digit code"
          autoFocus
          className={`${inputClass} text-center font-mono tracking-[0.3em]`}
        />
        <button type="submit" disabled={verifying} className={primaryButton}>
          {verifying ? "Checking…" : "Sign in"}
        </button>
        {verified.error ? <span className="text-[12px] text-bad-fg">{verified.error}</span> : null}
      </form>
      <form action={sendAction} className="flex justify-center gap-[14px] text-[12px]">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="resend" value="1" />
        <button type="submit" disabled={sending} className="cursor-pointer text-muted underline disabled:opacity-50">
          {sending ? "Sending…" : "Send a new code"}
        </button>
        <a href="/login" className="text-muted underline">
          Use a different email
        </a>
      </form>
      {sent.error && sent.sentTo ? <span className="text-[12px] text-bad-fg">{sent.error}</span> : null}
    </div>
  );
}
