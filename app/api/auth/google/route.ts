import { NextResponse, type NextRequest } from "next/server";
import { startGoogleLogin } from "@/lib/auth";
import { originFromHeaders } from "@/lib/request-origin";

/** Starts "Continue with Google" from the login page — redirects to Google's consent screen. */
export async function GET(request: NextRequest) {
  const origin = originFromHeaders(request.headers);
  const url = await startGoogleLogin(origin);
  return NextResponse.redirect(url);
}
