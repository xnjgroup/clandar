import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody } from "@/lib/api";
import { getConnectorForOrg, setMcpDisabledTools, setMcpToolEnabled } from "@/lib/connectors";
import { connectorJson } from "@/lib/connector-json";

type Context = { params: Promise<{ id: string }> };

/**
 * PATCH { tool, enabled } — switch one of an MCP server's tools on/off for the assistant — or
 * { allEnabled } for all of them → { connector }.
 */
export const PATCH = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Connector");
  const connector = await getConnectorForOrg(id, org.id);
  if (!connector || connector.kind !== "mcp") throw new ApiError(404, "Connector not found.");
  const body = await jsonBody<{ tool?: string; enabled?: boolean; allEnabled?: boolean }>(request);
  if (typeof body.allEnabled === "boolean") {
    await setMcpDisabledTools(id, org.id, body.allEnabled ? [] : connector.tools.map((t) => t.name));
  } else if (typeof body.tool === "string" && typeof body.enabled === "boolean") {
    await setMcpToolEnabled(id, org.id, body.tool, body.enabled);
  } else {
    throw new ApiError(400, "Send { tool, enabled } or { allEnabled }.");
  }
  return NextResponse.json({ connector: connectorJson((await getConnectorForOrg(id, org.id))!) });
});
