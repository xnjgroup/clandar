import { NextResponse } from "next/server";
import { CORS_HEADERS } from "@/lib/mcp-server-metadata";
import { revokeToken } from "@/lib/mcp-server-auth";

/** Token revocation (RFC 7009): the agent disconnects itself. Always 200. */
export async function POST(request: Request) {
  const params = new URLSearchParams(await request.text());
  const value = params.get("token");
  if (value) await revokeToken(value);
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
