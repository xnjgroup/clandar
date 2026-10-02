import { NextResponse, type NextRequest } from "next/server";
import { consumeOAuthState, getConnector, logConnectorEvent, probeMcpConnector } from "@/lib/connectors";
import { completeMcpOAuth } from "@/lib/mcp-oauth";

/**
 * Where an MCP server's sign-in sends the browser back. The stored `state` maps to the connector (and
 * the exact redirect URI used); the code is exchanged for tokens server-side, then the connector is
 * checked right away.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code");
  const error = params.get("error");
  const back = (message: string) =>
    NextResponse.redirect(new URL(`/connectors?notice=${encodeURIComponent(message)}`, request.url));

  const consumed = state ? await consumeOAuthState(state) : null;
  if (error) {
    if (consumed) await logConnectorEvent(consumed.connectorId, "auth", false, `Sign-in returned "${error}"`);
    return back(`The server declined the sign-in: ${params.get("error_description") ?? error}`);
  }
  if (!consumed) return back("That sign-in link expired — use Sign in on the connector again.");
  if (!code) return back("The server didn't return an authorization code.");

  const connector = await getConnector(consumed.connectorId);
  if (!connector?.url || !consumed.redirectUri) return back("That connector no longer exists.");
  try {
    await completeMcpOAuth(connector.id, connector.url, code, consumed.redirectUri);
    await logConnectorEvent(connector.id, "auth", true, "Signed in");
    const probe = await probeMcpConnector(connector);
    return back(probe.ok ? `${connector.name} connected — ${probe.message}.` : `Signed in, but the check failed: ${probe.message}`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unknown error";
    await logConnectorEvent(connector.id, "auth", false, message);
    return back(`Sign-in failed: ${message}`);
  }
}
