import { NextResponse } from "next/server";
import { CORS_HEADERS } from "@/lib/mcp-server-metadata";
import { exchangeCode, OAuthError, refreshTokens } from "@/lib/mcp-server-auth";

/** The token endpoint: an authorization code (with its PKCE verifier) or a refresh token → tokens. */
export async function POST(request: Request) {
  const headers = { ...CORS_HEADERS, "cache-control": "no-store", pragma: "no-cache" };
  let params: URLSearchParams;
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, string>;
    params = new URLSearchParams(body);
  } else {
    params = new URLSearchParams(await request.text());
  }
  const field = (name: string) => params.get(name)?.trim() ?? "";
  try {
    const grantType = field("grant_type");
    if (grantType === "authorization_code") {
      return NextResponse.json(
        await exchangeCode({ code: field("code"), clientId: field("client_id"), redirectUri: field("redirect_uri"), codeVerifier: field("code_verifier") }),
        { headers },
      );
    }
    if (grantType === "refresh_token") {
      return NextResponse.json(await refreshTokens({ refreshToken: field("refresh_token"), clientId: field("client_id") }), { headers });
    }
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  } catch (error) {
    const e = error instanceof OAuthError ? error : new OAuthError("server_error", "Something went wrong.", 500);
    return NextResponse.json({ error: e.code, error_description: e.message }, { status: e.status, headers });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
