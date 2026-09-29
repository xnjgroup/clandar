import Link from "next/link";
import { redirect } from "next/navigation";
import { googleOAuthConfigured } from "@/lib/connectors";
import { currentSession } from "@/lib/auth";
import { firstParam } from "@/lib/data";

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

        {googleOAuthConfigured() ? (
          <a
            href="/api/auth/google"
            className="flex w-full items-center justify-center gap-[10px] rounded-full bg-ink px-5 py-[11px] text-[13.5px] font-semibold text-bg"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.2-5.5 4.2-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.9 1.5l2.7-2.6C17 3.4 14.8 2.4 12 2.4 6.9 2.4 2.7 6.6 2.7 11.7s4.2 9.3 9.3 9.3c5.4 0 9-3.8 9-9.1 0-.6-.1-1.1-.2-1.6z"
              />
            </svg>
            Continue with Google
          </a>
        ) : (
          <p className="m-0 text-[12.5px] text-bad-fg">
            Google sign-in isn&rsquo;t configured yet — set GOOGLE_CLIENT_ID and
            GOOGLE_CLIENT_SECRET in .env.local.
          </p>
        )}

        <p className="m-0 text-[11px] leading-[1.6] text-faint">
          First time? Signing in creates your company&rsquo;s workspace. Already on a team?
          Sign in with the Google account your owner invited.
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
