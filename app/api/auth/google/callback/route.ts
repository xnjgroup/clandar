import { NextResponse, type NextRequest } from "next/server";
import { completeGoogleLogin, verifyLoginState } from "@/lib/auth";
import { originFromHeaders } from "@/lib/request-origin";

/** Where Google sends the browser after the person approves (or declines) signing in. */
export async function GET(request: NextRequest) {
  const origin = originFromHeaders(request.headers);
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state") ?? "";
  const error = params.get("error");

  const back = (message: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);

  if (error) return back(error === "access_denied" ? "Sign-in was cancelled." : `Google returned "${error}".`);
  if (!(await verifyLoginState(state))) return back("That sign-in link expired — try again.");
  if (!code) return back("Google did not return an authorization code.");

  try {
    await completeGoogleLogin(code, origin);
  } catch (cause) {
    return back(cause instanceof Error ? cause.message : "Sign-in failed.");
  }
  return NextResponse.redirect(`${origin}/overview`);
}
