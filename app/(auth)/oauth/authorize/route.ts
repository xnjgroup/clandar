import { NextResponse, type NextRequest } from "next/server";
import { currentSession, rememberAfterSignIn } from "@/lib/auth";
import { originFromHeaders } from "@/lib/request-origin";

/**
 * The authorization endpoint. Not signed in: remember this request and go to sign-in (which comes
 * back here). Signed in: the "Allow access" screen (/oauth/consent) with the same parameters.
 */
export async function GET(request: NextRequest) {
  const origin = originFromHeaders(request.headers);
  const query = request.nextUrl.search;
  if (!(await currentSession())) {
    await rememberAfterSignIn(`/oauth/authorize${query}`);
    return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/oauth/consent${query}`);
}
