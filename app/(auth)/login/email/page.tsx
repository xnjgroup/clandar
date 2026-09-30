import Link from "next/link";
import { firstParam } from "@/lib/data";
import { peekLoginLink } from "@/lib/email-login";
import { confirmEmailLink } from "../actions";
import { BrandMark } from "@/components/brand-mark";

/**
 * Where an emailed sign-in link lands. Signing in takes a button press, not
 * just the visit, so mail scanners that open every link don't use it up.
 */
export default async function EmailLinkPage({ searchParams }: PageProps<"/login/email">) {
  const token = firstParam((await searchParams).token);
  const email = await peekLoginLink(token);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="flex w-full max-w-[380px] flex-col items-center gap-5 rounded-[20px] border border-line bg-surface px-8 py-10 text-center">
        <BrandMark size={34} />
        {email ? (
          <form action={confirmEmailLink} className="flex w-full flex-col items-center gap-4">
            <input type="hidden" name="token" value={token} />
            <p className="m-0 text-[13.5px] leading-[1.5]">
              Sign in to Clandar as <span className="font-semibold">{email}</span>
            </p>
            <button
              type="submit"
              className="h-[44px] w-full cursor-pointer rounded-full bg-ink text-[13.5px] font-semibold text-bg"
            >
              Continue
            </button>
          </form>
        ) : (
          <>
            <p className="m-0 text-[13.5px] leading-[1.5]">That sign-in link has expired or was already used.</p>
            <Link href="/login" className="text-[13px] font-medium underline">
              Send a new one
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
