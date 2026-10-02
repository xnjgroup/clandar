import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { addMcpServerFor } from "@/lib/connector-setup";
import { getConnectorForOrg, googleOAuthConfigured, listConnectors } from "@/lib/connectors";
import { connectorJson } from "@/lib/connector-json";
import { originFromHeaders } from "@/lib/request-origin";

/** GET → { connectors, googleConfigured }. */
export const GET = api(async () => {
  const { org } = await apiSession();
  const connectors = await listConnectors(org.id);
  return NextResponse.json({ connectors: connectors.map(connectorJson), googleConfigured: googleOAuthConfigured() });
});

/**
 * POST { name, url, authType: none|bearer|api-key|basic|oauth2, secret?, headerName? } — adds an MCP
 * server and checks it → { ok?, error?, signInUrl?, connector? }. signInUrl: open it in the sign-in
 * sheet; it comes back to clandar://connectors.
 */
export const POST = api(async (request: Request) => {
  const session = await apiSession();
  const body = await jsonBody<Record<string, unknown>>(request);
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
  const result = await addMcpServerFor(
    { orgId: session.org.id, personId: session.person.id },
    { name: text("name"), url: text("url"), authType: text("authType") || "none", secret: text("secret"), headerName: text("headerName") },
    originFromHeaders(request.headers),
    true,
  );
  if (result.error && !result.connectorId) throw new ApiError(400, result.error);
  const connector = result.connectorId ? await getConnectorForOrg(result.connectorId, session.org.id) : null;
  return NextResponse.json({ ...result, connector: connector ? connectorJson(connector) : null });
});
