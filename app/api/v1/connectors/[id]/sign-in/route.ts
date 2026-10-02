import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam } from "@/lib/api";
import { startConnectorSignIn } from "@/lib/connector-setup";
import { originFromHeaders } from "@/lib/request-origin";

type Context = { params: Promise<{ id: string }> };

/**
 * POST → { signInUrl } (Google's consent / the MCP server's sign-in page — it comes back to
 * clandar://connectors), or { ok } when no sign-in was needed.
 */
export const POST = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Connector");
  const result = await startConnectorSignIn(id, org.id, originFromHeaders(request.headers), true);
  if (result.error) throw new ApiError(400, result.error);
  return NextResponse.json(result);
});
