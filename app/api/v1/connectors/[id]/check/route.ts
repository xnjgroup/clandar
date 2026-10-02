import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam } from "@/lib/api";
import { getConnectorForOrg, probeConnector } from "@/lib/connectors";
import { connectorJson } from "@/lib/connector-json";

type Context = { params: Promise<{ id: string }> };

/** POST → { ok, message, connector }: Test — for an MCP server this also refreshes its tool list. */
export const POST = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Connector");
  const connector = await getConnectorForOrg(id, org.id);
  if (!connector) throw new ApiError(404, "Connector not found.");
  const before = new Set(connector.tools.map((t) => t.name));
  const probe = (await probeConnector(connector)) as { ok: boolean; message: string } | undefined;
  const after = (await getConnectorForOrg(id, org.id))!;
  let message = probe?.message ?? (after.status === "connected" ? "Connected" : (after.statusDetail ?? after.status));
  if (after.kind === "mcp" && after.status === "connected") {
    const added = after.tools.filter((t) => !before.has(t.name)).length;
    const removed = [...before].filter((n) => !after.tools.some((t) => t.name === n)).length;
    const changes = [added ? `${added} new` : "", removed ? `${removed} removed` : ""].filter(Boolean).join(", ");
    message = `${after.tools.length} tool${after.tools.length === 1 ? "" : "s"}${changes ? ` — ${changes}` : " — no changes"}`;
  }
  return NextResponse.json({ ok: after.status === "connected", message, connector: connectorJson(after) });
});
