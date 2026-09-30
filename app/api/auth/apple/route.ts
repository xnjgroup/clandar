import { NextResponse, type NextRequest } from "next/server";
import { startAppleLogin } from "@/lib/apple-login";
import { originFromHeaders } from "@/lib/request-origin";

/** Starts "Continue with Apple" from the login page — redirects to Apple's sign-in. */
export async function GET(request: NextRequest) {
  const origin = originFromHeaders(request.headers);
  try {
    return NextResponse.redirect(await startAppleLogin(origin));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign in with Apple isn't available.";
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);
  }
}
