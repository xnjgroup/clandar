/**
 * Adding an MCP server and starting a connector's sign-in — shared by the website's Connectors page
 * (server actions) and the app's /api/v1/connectors, so both behave the same.
 */
import { encryptionConfigured } from "@/lib/crypto";
import {
  createMcpConnector,
  getConnector,
  getConnectorForOrg,
  logConnectorEvent,
  probeMcpConnector,
  reauthorizeGoogleConnector,
  setConnectorOAuth,
  type AuthType,
} from "@/lib/connectors";
import { startMcpOAuth } from "@/lib/mcp-oauth";

export const MCP_AUTH_TYPES: AuthType[] = ["none", "bearer", "api-key", "basic", "oauth2"];

/** What happened: a message (ok or not), or a sign-in page to open. */
export type SetupResult = { ok?: string; error?: string; signInUrl?: string; connectorId?: string };

/**
 * Starts the OAuth sign-in for an MCP connector (discovery + registration by the SDK): the page to
 * open, or a message when there's nothing to sign in to / it failed.
 */
export async function startMcpSignIn(
  id: string,
  url: string,
  orgId: string,
  origin: string,
  options: { switchToOAuth?: boolean; fromApp?: boolean } = {},
): Promise<SetupResult> {
  if (!encryptionConfigured()) return { error: "APP_ENCRYPTION_KEY is not set, so sign-in tokens cannot be stored." };
  try {
    if (options.switchToOAuth) await setConnectorOAuth(id, orgId);
    const target = await startMcpOAuth(id, url, origin, options.fromApp);
    if (!target) {
      const connector = await getConnector(id);
      if (connector) await probeMcpConnector(connector);
      return { ok: "Signed in." };
    }
    await logConnectorEvent(id, "auth", true, `Sign-in started at ${target.host}`);
    return { signInUrl: target.toString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await logConnectorEvent(id, "auth", false, message);
    return { error: `Couldn't start the sign-in: ${message}` };
  }
}

/** "Sign in again" / "Reconnect" on any connector: Google consent, or the MCP server's sign-in. */
export async function startConnectorSignIn(id: string, orgId: string, origin: string, fromApp = false): Promise<SetupResult> {
  const connector = await getConnectorForOrg(id, orgId);
  if (!connector) return { error: "Connector not found." };
  if (connector.kind === "google_gmail" || connector.kind === "google_calendar") {
    return { signInUrl: await reauthorizeGoogleConnector(id, orgId, origin, fromApp) };
  }
  if (!connector.url) return { error: "This connector has no server URL." };
  return startMcpSignIn(id, connector.url, orgId, origin, { switchToOAuth: connector.authType !== "oauth2", fromApp });
}

/** Adds any HTTP MCP server, runs the handshake, and starts its sign-in when it needs one. */
export async function addMcpServerFor(
  session: { orgId: string; personId: string },
  input: { name: string; url: string; authType: string; secret: string; headerName: string },
  origin: string,
  fromApp = false,
): Promise<SetupResult> {
  const { name, url, secret, headerName } = input;
  const authType = input.authType as AuthType;
  if (!name) return { error: "Give the server a name." };
  if (!MCP_AUTH_TYPES.includes(authType)) return { error: "Pick an authentication type." };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Enter the server's full URL, for example https://example.com/mcp." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "Only http:// and https:// URLs are supported." };
  }
  if (authType !== "none" && authType !== "oauth2" && !secret) {
    return { error: "This authentication type needs a token, key or user:password." };
  }
  if (authType !== "none" && authType !== "oauth2" && !encryptionConfigured()) {
    return { error: "APP_ENCRYPTION_KEY is not set, so credentials cannot be stored. Add one to .env.local." };
  }

  let id: string;
  try {
    id = await createMcpConnector({
      orgId: session.orgId,
      name,
      // Exactly as typed — parsing only validates it; URL's normalizing would rewrite slashes etc.
      url,
      authType,
      headerName: authType === "api-key" ? headerName || "X-API-Key" : null,
      secret: authType === "none" || authType === "oauth2" ? null : secret,
      createdBy: session.personId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("connectors_org_name_key")) return { error: `A connector named “${name}” already exists.` };
    return { error: message || "Could not save the connector." };
  }
  await logConnectorEvent(id, "created", true, `Added ${parsed.host}`);

  // OAuth sign-in: straight to the server's sign-in page.
  if (authType === "oauth2") return { ...(await startMcpSignIn(id, url, session.orgId, origin, { fromApp })), connectorId: id };

  const connector = await getConnector(id);
  const probe: { ok: boolean; message: string; unauthorized?: boolean } = connector
    ? await probeMcpConnector(connector)
    : { ok: false, message: "not found" };

  // Auto-discovery: a server added without auth that answers 401 and advertises OAuth → sign in.
  if (!probe.ok && probe.unauthorized && authType === "none") {
    const signIn = await startMcpSignIn(id, url, session.orgId, origin, { switchToOAuth: true, fromApp });
    if (signIn.signInUrl) return { ...signIn, connectorId: id };
  }

  return probe.ok
    ? { ok: `${name} connected — ${probe.message}.`, connectorId: id }
    : { error: `${name} was saved, but the handshake failed: ${probe.message}`, connectorId: id };
}
