import { NextResponse } from "next/server";
import { CORS_HEADERS } from "@/lib/mcp-server-metadata";
import { OAuthError, registerClient } from "@/lib/mcp-server-auth";

/** Dynamic client registration (RFC 7591): an AI agent registers its name and redirect URIs. */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: "Expected a JSON body." }, { status: 400, headers: CORS_HEADERS });
  }
  try {
    const client = await registerClient(body);
    return NextResponse.json(
      {
        client_id: client.clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      { status: 201, headers: CORS_HEADERS },
    );
  } catch (error) {
    const e = error instanceof OAuthError ? error : new OAuthError("invalid_client_metadata", "Couldn't register.");
    return NextResponse.json({ error: e.code, error_description: e.message }, { status: 400, headers: CORS_HEADERS });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
