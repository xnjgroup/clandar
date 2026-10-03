import { NextResponse } from "next/server";
import { authorizationServerMetadata, CORS_HEADERS } from "@/lib/mcp-server-metadata";
import { originFromHeaders } from "@/lib/request-origin";

/** Clandar's OAuth endpoints, for MCP clients. */
export async function GET(request: Request) {
  return NextResponse.json(authorizationServerMetadata(originFromHeaders(request.headers)), { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
