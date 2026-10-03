import { NextResponse, type NextRequest } from "next/server";
import { completeAppleLogin } from "@/lib/apple-login";
import { takeAfterSignIn } from "@/lib/auth";
import { originFromHeaders } from "@/lib/request-origin";

/** Where Apple POSTs back (response_mode=form_post) after the person signs in — or cancels. */
export async function POST(request: NextRequest) {
  const origin = originFromHeaders(request.headers);
  try {
    await completeAppleLogin(await request.formData());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    // 303: turn Apple's POST into a GET of the login page.
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`, 303);
  }
  return NextResponse.redirect(`${origin}${await takeAfterSignIn()}`, 303);
}
