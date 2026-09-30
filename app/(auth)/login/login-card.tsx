import Link from "next/link";
import { appleLoginConfigured } from "@/lib/apple-login";
import { googleOAuthConfigured } from "@/lib/connectors";
import { mailerConfigured } from "@/lib/mailer";
import { EmailLogin } from "./email-login";

const outlineButton =
  "flex h-[42px] w-full items-center justify-center gap-[9px] rounded-[12px] border border-line bg-surface text-[13.5px] font-semibold text-ink hover:bg-bg";

/**
 * The sign-in card — on the landing page's first screen and on /login. The same three ways in
 * as the iOS app (Google, Apple, a link/code by email), each shown once it's configured; all
 * reach one account per email address (lib/auth.ts signInWithIdentity).
 */
export function LoginCard({ error }: { error?: string }) {
  const google = googleOAuthConfigured();
  const apple = appleLoginConfigured();
  const email = mailerConfigured();

  return (
    <div className="flex w-full max-w-[380px] flex-col gap-[10px] rounded-[20px] border border-line bg-surface p-[18px] shadow-[0_12px_40px_rgba(16,18,17,0.07)]">
      {error ? (
        <p className="m-0 rounded-[12px] bg-bad-bg px-3 py-2 text-center text-[12px] leading-[1.5] text-bad-fg">{error}</p>
      ) : null}
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
      {email ? <EmailLogin /> : null}
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
