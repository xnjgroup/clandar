import { NextResponse } from "next/server";
import { CORS_HEADERS, protectedResourceMetadata } from "@/lib/mcp-server-metadata";
import { originFromHeaders } from "@/lib/request-origin";

/** Where an MCP client learns which authorization server protects /mcp. */
export async function GET(request: Request) {
  return NextResponse.json(protectedResourceMetadata(originFromHeaders(request.headers)), { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
