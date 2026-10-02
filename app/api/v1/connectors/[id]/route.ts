import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody } from "@/lib/api";
import { deleteConnector, getConnectorForOrg, logConnectorEvent, setConnectorEnabled } from "@/lib/connectors";
import { connectorJson } from "@/lib/connector-json";

type Context = { params: Promise<{ id: string }> };

/** PATCH { enabled } → { connector }. */
export const PATCH = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Connector");
  if (!(await getConnectorForOrg(id, org.id))) throw new ApiError(404, "Connector not found.");
  const { enabled } = await jsonBody<{ enabled?: boolean }>(request);
  if (typeof enabled === "boolean") {
    await setConnectorEnabled(id, org.id, enabled);
    await logConnectorEvent(id, "updated", true, enabled ? "Enabled" : "Disabled");
  }
  return NextResponse.json({ connector: connectorJson((await getConnectorForOrg(id, org.id))!) });
});

/** DELETE → { ok }. */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Connector");
  await deleteConnector(id, org.id);
  return NextResponse.json({ ok: true });
});
