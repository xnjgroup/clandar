import Link from "next/link";
import { redirect } from "next/navigation";
import { googleOAuthConfigured } from "@/lib/connectors";
import { currentSession } from "@/lib/auth";
import { firstParam } from "@/lib/data";
import { appleLoginConfigured } from "@/lib/apple-login";
import { mailerConfigured } from "@/lib/mailer";
import { EmailLogin } from "./email-login";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await currentSession();
  if (session) redirect("/overview");

  const params = await searchParams;
  const error = firstParam(params.error);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="flex w-full max-w-[380px] flex-col items-center gap-6 rounded-[20px] border border-line bg-surface px-8 py-10 text-center">
        <div className="flex flex-col items-center gap-2">
          <Link
            href="/"
            className="flex size-[46px] items-center justify-center rounded-[14px] bg-ink text-[20px] font-bold text-lime"
          >
            C.
          </Link>
          <h1 className="m-0 text-[20px] font-bold tracking-[-0.02em]">Clandar</h1>
          <p className="m-0 text-[13px] text-muted">Sign in to your company&rsquo;s workspace</p>
        </div>

        {error ? (
          <p className="m-0 w-full rounded-[12px] bg-bad-bg px-3 py-2 text-[12px] leading-[1.5] text-bad-fg">
            {error}
          </p>
        ) : null}

        {/* The same three ways in as the iOS app: Google, Apple, or a link/code by email — all reach
            one account per email address (lib/auth.ts signInWithIdentity). */}
        <div className="flex w-full flex-col gap-[10px]">
          {googleOAuthConfigured() ? (
            <a
              href="/api/auth/google"
              className="flex h-[44px] w-full items-center justify-center gap-[10px] rounded-full bg-ink px-5 text-[13.5px] font-semibold text-bg"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.2-5.5 4.2-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.9 1.5l2.7-2.6C17 3.4 14.8 2.4 12 2.4 6.9 2.4 2.7 6.6 2.7 11.7s4.2 9.3 9.3 9.3c5.4 0 9-3.8 9-9.1 0-.6-.1-1.1-.2-1.6z" />
              </svg>
              Continue with Google
            </a>
          ) : null}
          {appleLoginConfigured() ? (
            <a
              href="/api/auth/apple"
              className="flex h-[44px] w-full items-center justify-center gap-[10px] rounded-full bg-ink px-5 text-[13.5px] font-semibold text-bg"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16.37 12.62c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.54 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.52ZM14.2 6.16c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22Z" />
              </svg>
              Continue with Apple
            </a>
          ) : null}
          {mailerConfigured() ? (
            <EmailLogin />
          ) : !googleOAuthConfigured() && !appleLoginConfigured() ? (
            <p className="m-0 text-[12.5px] text-bad-fg">
              No sign-in method is configured yet — set GOOGLE_CLIENT_ID/SECRET, APPLE_CLIENT_ID or SMTP_URL.
            </p>
          ) : null}
        </div>

        <p className="m-0 text-[11px] leading-[1.6] text-faint">
          First time? Signing in creates your company&rsquo;s workspace. Already on a team?
          Use the email address your owner invited — with Google, Apple or the email link.
        </p>

        <p className="m-0 text-[11px] leading-[1.6] text-faint">
          By continuing, you agree to Clandar&rsquo;s{" "}
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
    </div>
  );
}
