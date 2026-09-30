import { appleLoginConfigured } from "@/lib/apple-login";
import { googleOAuthConfigured } from "@/lib/connectors";
import { mailerConfigured } from "@/lib/mailer";
import { LoginOptions } from "./email-login";

/**
 * The sign-in card on the landing page's first screen. The same three ways in as the iOS app
 * (Google, Apple, a link/code by email), each shown once it's configured; all reach one account
 * per email address (lib/auth.ts signInWithIdentity). The steps themselves are in LoginOptions.
 */
export function LoginCard({ error }: { error?: string }) {
  return (
    <div className="flex w-full max-w-[380px] flex-col gap-[10px] rounded-[20px] border border-line bg-surface p-[18px] shadow-[0_12px_40px_rgba(16,18,17,0.07)]">
      {error ? (
        <p className="m-0 rounded-[12px] bg-bad-bg px-3 py-2 text-center text-[12px] leading-[1.5] text-bad-fg">{error}</p>
      ) : null}
      <LoginOptions google={googleOAuthConfigured()} apple={appleLoginConfigured()} email={mailerConfigured()} />
    </div>
  );
}
