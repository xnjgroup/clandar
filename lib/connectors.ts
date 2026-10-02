/**
 * Connectors are the systems this dashboard talks to: remote MCP servers over
 * HTTP, and Google accounts (Gmail, Calendar) connected with OAuth.
 *
 * Secrets never leave the server: they are written encrypted by `lib/crypto.ts`
 * and only decrypted inside the probe functions below.
 */
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { query, queryOne } from "@/lib/db";
import { mcpAccessToken } from "@/lib/mcp-oauth";

export type ConnectorKind = "mcp" | "google_gmail" | "google_calendar";
export type ConnectorStatus = "unverified" | "pending_auth" | "connected" | "error" | "disabled";
export type AuthType = "none" | "bearer" | "api-key" | "basic" | "oauth2";

export type Connector = {
  id: string;
  orgId: string;
  kind: ConnectorKind;
  name: string;
  url: string | null;
  transport: "http" | "sse";
  authType: AuthType;
  headerName: string | null;
  hasSecret: boolean;
  accountLabel: string | null;
  scopes: string[];
  enabled: boolean;
  status: ConnectorStatus;
  statusDetail: string | null;
  toolCount: number | null;
  lastCheckedAt: Date | null;
  tokenExpiresAt: Date | null;
  metadata: Record<string, unknown>;
  tools: { name: string; description: string }[];
};

type ConnectorRow = {
  id: string;
  org_id: string;
  kind: ConnectorKind;
  name: string;
  url: string | null;
  transport: "http" | "sse";
  auth_type: AuthType;
  header_name: string | null;
  has_secret: boolean;
  account_label: string | null;
  oauth_scopes: string[];
  is_enabled: boolean;
  status: ConnectorStatus;
  status_detail: string | null;
  tool_count: number | null;
  last_checked_at: Date | null;
  token_expires_at: Date | null;
  metadata: Record<string, unknown>;
};

const SELECT_COLUMNS = `id, org_id, kind, name, url, transport, auth_type, header_name,
       (secret_cipher IS NOT NULL) AS has_secret, account_label, oauth_scopes,
       is_enabled, status, status_detail, tool_count, last_checked_at,
       token_expires_at, metadata`;

function toConnector(row: ConnectorRow, tools: { name: string; description: string }[]): Connector {
  return {
    id: row.id,
    orgId: row.org_id,
    kind: row.kind,
    name: row.name,
    url: row.url,
    transport: row.transport,
    authType: row.auth_type,
    headerName: row.header_name,
    hasSecret: row.has_secret,
    accountLabel: row.account_label,
    scopes: row.oauth_scopes,
    enabled: row.is_enabled,
    status: row.status,
    statusDetail: row.status_detail,
    toolCount: row.tool_count,
    lastCheckedAt: row.last_checked_at,
    tokenExpiresAt: row.token_expires_at,
    metadata: row.metadata,
    tools,
  };
}

export async function listConnectors(orgId: string): Promise<Connector[]> {
  const rows = await query<ConnectorRow>(
    `SELECT ${SELECT_COLUMNS} FROM connectors WHERE org_id = $1 ORDER BY created_at`,
    [orgId],
  );
  if (rows.length === 0) return [];

  const tools = await query<{ connector_id: string; name: string; description: string }>(
    `SELECT connector_id, name, description FROM connector_tools ORDER BY name`,
  );
  return rows.map((row) =>
    toConnector(
      row,
      tools.filter((t) => t.connector_id === row.id).map((t) => ({ name: t.name, description: t.description })),
    ),
  );
}

export async function getConnector(id: string): Promise<Connector | null> {
  const row = await queryOne<ConnectorRow>(
    `SELECT ${SELECT_COLUMNS} FROM connectors WHERE id = $1`,
    [id],
  );
  if (!row) return null;
  const tools = await query<{ name: string; description: string }>(
    `SELECT name, description FROM connector_tools WHERE connector_id = $1 ORDER BY name`,
    [id],
  );
  return toConnector(row, tools);
}

/** `getConnector`, but `null` unless it also belongs to `orgId` — the check every user-facing action on a user-supplied id needs, so one org can't probe or act on another's connector by guessing its id. */
export async function getConnectorForOrg(id: string, orgId: string): Promise<Connector | null> {
  const row = await queryOne<{ org_id: string }>(`SELECT org_id FROM connectors WHERE id = $1`, [id]);
  if (!row || row.org_id !== orgId) return null;
  return getConnector(id);
}

export type ConnectorEvent = { id: string; kind: string; ok: boolean; message: string; at: Date };

export async function recentConnectorEvents(
  orgId: string,
  limit = 6,
): Promise<(ConnectorEvent & { connector: string })[]> {
  const rows = await query<{
    id: string;
    kind: string;
    ok: boolean;
    message: string;
    occurred_at: Date;
    connector: string;
  }>(
    `SELECT e.id, e.kind, e.ok, e.message, e.occurred_at, c.name AS connector
       FROM connector_events e
       JOIN connectors c ON c.id = e.connector_id
      WHERE c.org_id = $1
      ORDER BY e.occurred_at DESC
      LIMIT $2`,
    [orgId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    ok: r.ok,
    message: r.message,
    at: r.occurred_at,
    connector: r.connector,
  }));
}

/* ── Writes ───────────────────────────────────────────────── */

export async function logConnectorEvent(
  connectorId: string,
  kind: "created" | "updated" | "check" | "auth" | "deleted",
  ok: boolean,
  message: string,
) {
  await query(
    `INSERT INTO connector_events (connector_id, kind, ok, message) VALUES ($1, $2, $3, $4)`,
    [connectorId, kind, ok, message.slice(0, 500)],
  );
}

export async function createMcpConnector(input: {
  orgId: string;
  name: string;
  url: string;
  authType: AuthType;
  headerName: string | null;
  secret: string | null;
  createdBy: string | null;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO connectors (org_id, kind, name, url, transport, auth_type, header_name, secret_cipher, created_by)
     VALUES ($1, 'mcp', $2, $3, 'http', $4, $5, $6, $7)
     RETURNING id`,
    [
      input.orgId,
      input.name,
      input.url,
      input.authType,
      input.headerName,
      input.secret ? encryptSecret(input.secret) : null,
      input.createdBy,
    ],
  );
  return row!.id;
}

/** Switches one of an MCP connector's tools on or off for the assistant (kept in metadata.disabledTools). */
export async function setMcpToolEnabled(id: string, orgId: string, tool: string, enabled: boolean) {
  await query(
    `UPDATE connectors
        SET metadata = jsonb_set(
              coalesce(metadata, '{}'::jsonb),
              '{disabledTools}',
              CASE WHEN $4
                   THEN coalesce(metadata->'disabledTools', '[]'::jsonb) - $3
                   ELSE (coalesce(metadata->'disabledTools', '[]'::jsonb) - $3) || to_jsonb($3::text)
              END)
      WHERE id = $1 AND org_id = $2 AND kind = 'mcp'`,
    [id, orgId, tool, enabled],
  );
}

/** Sets the whole list of an MCP connector's switched-off tools (the dialog's All on / All off). */
export async function setMcpDisabledTools(id: string, orgId: string, tools: string[]) {
  await query(
    `UPDATE connectors SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{disabledTools}', $3::jsonb)
      WHERE id = $1 AND org_id = $2 AND kind = 'mcp'`,
    [id, orgId, JSON.stringify(tools)],
  );
}

/** Switches an MCP connector to OAuth sign-in (found by discovery after a 401). */
export async function setConnectorOAuth(id: string, orgId: string) {
  await query(
    `UPDATE connectors SET auth_type = 'oauth2', header_name = NULL, secret_cipher = NULL, status = 'pending_auth',
            status_detail = 'Sign-in needed'
      WHERE id = $1 AND org_id = $2 AND kind = 'mcp'`,
    [id, orgId],
  );
}

/** `orgId` scopes the update so one org can never toggle/delete another's connector by guessing an id. */
export async function setConnectorEnabled(id: string, orgId: string, enabled: boolean) {
  await query(
    `UPDATE connectors
        SET is_enabled = $3,
            status = CASE WHEN $3 THEN 'unverified' ELSE 'disabled' END
      WHERE id = $1 AND org_id = $2`,
    [id, orgId, enabled],
  );
}

export async function deleteConnector(id: string, orgId: string) {
  await query(`DELETE FROM connectors WHERE id = $1 AND org_id = $2`, [id, orgId]);
}

async function recordCheck(
  id: string,
  ok: boolean,
  detail: string,
  extra: {
    toolCount?: number | null;
    accountLabel?: string | null;
    /** Renames the row once its account is known — "Gmail" → "Gmail — a@b.com". */
    name?: string | null;
    metadata?: unknown;
  } = {},
) {
  await query(
    `UPDATE connectors
        SET status = $2,
            status_detail = $3,
            tool_count = COALESCE($4, tool_count),
            account_label = COALESCE($5, account_label),
            name = COALESCE($7, name),
            metadata = COALESCE($6::jsonb, metadata),
            last_checked_at = now()
      WHERE id = $1`,
    [
      id,
      ok ? "connected" : "error",
      detail.slice(0, 500),
      extra.toolCount ?? null,
      extra.accountLabel ?? null,
      extra.metadata === undefined ? null : JSON.stringify(extra.metadata),
      extra.name ?? null,
    ],
  );
  await logConnectorEvent(id, "check", ok, detail);
}

async function replaceTools(id: string, tools: { name: string; description: string }[]) {
  await query(`DELETE FROM connector_tools WHERE connector_id = $1`, [id]);
  for (const tool of tools) {
    await query(
      `INSERT INTO connector_tools (connector_id, name, description) VALUES ($1, $2, $3)
       ON CONFLICT (connector_id, name) DO UPDATE SET description = excluded.description`,
      [id, tool.name.slice(0, 200), (tool.description ?? "").slice(0, 500)],
    );
  }
}

/* ── MCP probe ────────────────────────────────────────────── */

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "clandar-expense", version: "0.1.0" };
const PROBE_TIMEOUT_MS = 10_000;

async function authHeaders(
  id: string,
  authType: AuthType,
  headerName: string | null,
): Promise<Record<string, string>> {
  if (authType === "none") return {};
  const row = await queryOne<{ secret_cipher: string | null }>(
    `SELECT secret_cipher FROM connectors WHERE id = $1`,
    [id],
  );
  if (!row?.secret_cipher) return {};
  const secret = decryptSecret(row.secret_cipher);

  if (authType === "bearer" || authType === "oauth2") {
    return { Authorization: `Bearer ${secret}` };
  }
  if (authType === "basic") {
    return { Authorization: `Basic ${Buffer.from(secret).toString("base64")}` };
  }
  return { [headerName || "X-API-Key"]: secret };
}

/**
 * The auth headers for calling an MCP connector — its token / API key / basic auth, or for OAuth a
 * current access token (refreshed when needed). Null when an OAuth connector needs signing in again.
 */
export async function mcpAuthHeaders(connector: Connector): Promise<Record<string, string> | null> {
  if (connector.authType === "oauth2") {
    const token = connector.url ? await mcpAccessToken(connector.id, connector.url) : null;
    return token ? { Authorization: `Bearer ${token}` } : null;
  }
  return authHeaders(connector.id, connector.authType, connector.headerName);
}

/** A tool as the assistant needs it: its inputs (and MCP's readOnlyHint, kept for later use). */
export type McpToolSpec = { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean };

type JsonRpcResult = { result?: unknown; error?: { code: number; message: string } };

/** Reads a JSON-RPC reply from either a JSON body or an SSE `data:` frame. */
async function readRpc(response: Response): Promise<JsonRpcResult> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        return JSON.parse(payload) as JsonRpcResult;
      } catch {
        // Keep scanning — a server may send comments or partial frames first.
      }
    }
    throw new Error("No JSON-RPC frame in the event stream");
  }

  if (!text) throw new Error(`Empty response (HTTP ${response.status})`);
  return JSON.parse(text) as JsonRpcResult;
}

/**
 * Runs the MCP handshake against a connector's URL and records what came back:
 * `initialize`, then `tools/list`. Streamable HTTP; a session id is echoed back
 * when the server issues one.
 */
export async function probeMcpConnector(connector: Connector) {
  if (!connector.url) {
    await recordCheck(connector.id, false, "No URL configured");
    return { ok: false, message: "No URL configured" };
  }

  const auth = await mcpAuthHeaders(connector);
  if (!auth) {
    const detail = "Sign-in needed — use Sign in on this connector";
    await recordCheck(connector.id, false, detail);
    return { ok: false, message: detail, unauthorized: true };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...auth,
  };

  const post = (body: unknown, sessionId?: string | null) =>
    fetch(connector.url!, {
      method: "POST",
      headers: sessionId ? { ...headers, "mcp-session-id": sessionId } : headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });

  try {
    const initResponse = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
    });

    if (initResponse.status === 401 || initResponse.status === 403) {
      const detail =
        connector.authType === "oauth2"
          ? "Sign-in expired — use Sign in on this connector"
          : `Server rejected the credentials (HTTP ${initResponse.status})`;
      await recordCheck(connector.id, false, detail);
      return { ok: false, message: detail, unauthorized: initResponse.status === 401 };
    }
    if (!initResponse.ok) {
      const detail = `initialize failed — HTTP ${initResponse.status}`;
      await recordCheck(connector.id, false, detail);
      return { ok: false, message: detail };
    }

    const sessionId = initResponse.headers.get("mcp-session-id");
    const init = await readRpc(initResponse);
    if (init.error) {
      const detail = `initialize error — ${init.error.message}`;
      await recordCheck(connector.id, false, detail);
      return { ok: false, message: detail };
    }

    const serverInfo = (init.result as { serverInfo?: { name?: string; version?: string } })?.serverInfo;

    // Best-effort: some servers require it, none mind receiving it.
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId).catch(() => null);

    const toolsResponse = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      sessionId,
    );
    let tools: { name: string; description: string }[] = [];
    // Kept in metadata for the assistant (lib/mcp-tools.ts): inputs and the read-only hint.
    let specs: McpToolSpec[] = [];
    if (toolsResponse.ok) {
      const listed = await readRpc(toolsResponse).catch(() => ({ result: undefined }));
      const raw = (
        listed.result as {
          tools?: { name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean } }[];
        }
      )?.tools;
      tools = (raw ?? []).map((t) => ({ name: t.name, description: t.description ?? "" }));
      specs = (raw ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema ?? { type: "object", properties: {} },
        readOnly: t.annotations?.readOnlyHint === true,
      }));
    }

    await replaceTools(connector.id, tools);
    const label = serverInfo?.name
      ? `${serverInfo.name}${serverInfo.version ? ` ${serverInfo.version}` : ""}`
      : "MCP server";
    const detail = `${label} — ${tools.length} tool${tools.length === 1 ? "" : "s"}`;
    await recordCheck(connector.id, true, detail, {
      toolCount: tools.length,
      metadata: {
        serverInfo: serverInfo ?? null,
        protocolVersion: PROTOCOL_VERSION,
        tools: specs,
        // The tools switched off on the Connectors page survive a re-check.
        disabledTools: Array.isArray(connector.metadata?.disabledTools) ? connector.metadata.disabledTools : [],
      },
    });
    return { ok: true, message: detail };
  } catch (error) {
    const detail = describeFetchFailure(error, connector.url);
    await recordCheck(connector.id, false, detail);
    return { ok: false, message: detail };
  }
}

/** Turns undici's terse network errors into something a reader can act on. */
function describeFetchFailure(error: unknown, url: string) {
  if (!(error instanceof Error)) return "Unknown error";
  if (error.name === "TimeoutError") return `No response within ${PROBE_TIMEOUT_MS / 1000}s`;
  if (error.message === "fetch failed") {
    const code = (error.cause as { code?: string } | undefined)?.code;
    const host = URL.canParse(url) ? new URL(url).host : url;
    if (code === "ECONNREFUSED") return `Nothing is listening on ${host}`;
    if (code === "ENOTFOUND") return `Host ${host} could not be resolved`;
    if (code === "CERT_HAS_EXPIRED") return `The TLS certificate for ${host} has expired`;
    return `Could not reach ${host}${code ? ` (${code})` : ""}`;
  }
  return error.message;
}

/* ── Google connectors ────────────────────────────────────── */

const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export const GOOGLE_SERVICES = {
  google_gmail: {
    label: "Gmail",
    description: "Read invoices and receipts forwarded to your inbox",
    // gmail.modify is a superset of gmail.readonly that adds trashing and
    // labeling — everything the cleanup worker needs — but explicitly excludes
    // permanent, bypass-Trash deletion. New connections request it directly;
    // an account connected before this still has only gmail.readonly until it
    // reconnects (see `hasGmailModifyScope`).
    scopes: [GMAIL_MODIFY_SCOPE],
    icon: "mail",
  },
  google_calendar: {
    label: "Google Calendar",
    description: "Match travel and event spend against your calendar",
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    icon: "clock",
  },
} as const satisfies Record<string, { label: string; description: string; scopes: string[]; icon: string }>;

export type GoogleService = keyof typeof GOOGLE_SERVICES;

export function isGoogleService(value: string): value is GoogleService {
  return value in GOOGLE_SERVICES;
}

/** Whether this connector's *granted* scope (not just what's requested today) allows trashing mail. */
export function hasGmailModifyScope(connector: Connector): boolean {
  return connector.scopes.includes(GMAIL_MODIFY_SCOPE);
}

export function googleOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env.local");
  }
  return { clientId, clientSecret };
}

/**
 * The callback URL to send Google, for a request that arrived at `origin`.
 * `GOOGLE_REDIRECT_URI` is an explicit opt-in override — set it to pin one
 * stable URL (typical for a production deployment behind a fixed domain);
 * leave it unset and this follows whatever address the browser is actually
 * using, which is what a multi-address setup like Tailscale needs.
 */
export function googleRedirectUri(origin: string): string {
  return process.env.GOOGLE_REDIRECT_URI || `${origin}/api/connectors/google/callback`;
}

/**
 * Creates (or reuses) the connector row and returns the consent URL to visit.
 * `origin` is the address the browser is actually using right now — see
 * `lib/request-origin.ts` — so the redirect URI matches it exactly.
 */
/**
 * Records a pending consent request for `connectorId` and returns the URL to
 * send the browser to. Shared by connecting a new account and reconnecting an
 * existing one — everything except how `connectorId` was obtained is identical.
 */
async function beginGoogleConsent(
  connectorId: string,
  service: GoogleService,
  origin: string,
  fromApp = false,
): Promise<string> {
  const { clientId } = googleCredentials();
  const redirectUri = googleRedirectUri(origin);
  const definition = GOOGLE_SERVICES[service];

  const state = oauthState(fromApp);
  await query(`DELETE FROM oauth_states WHERE connector_id = $1 OR expires_at < now()`, [
    connectorId,
  ]);
  // The exact redirect_uri travels with the state so the callback — which may
  // land on a different request than this one made it through — reuses the
  // identical value Google was given, rather than re-deriving it and risking
  // a mismatch.
  await query(`INSERT INTO oauth_states (state, connector_id, redirect_uri) VALUES ($1, $2, $3)`, [
    state,
    connectorId,
    redirectUri,
  ]);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", definition.scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Inserts a new connector row for `service`, naming it so it won't collide
 * with one already connected — "Gmail" for the first, "Gmail (2)" for the
 * next, and so on, however many accounts are added.
 */
async function insertGoogleConnectorRow(
  service: GoogleService,
  orgId: string,
  createdBy: string | null,
): Promise<string> {
  const definition = GOOGLE_SERVICES[service];
  const existing = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM connectors WHERE kind = $1 AND org_id = $2`,
    [service, orgId],
  );
  let ordinal = Number(existing?.count ?? 0) + 1;

  for (let attempt = 0; attempt < 5; attempt++) {
    const name = ordinal === 1 ? definition.label : `${definition.label} (${ordinal})`;
    try {
      const row = await queryOne<{ id: string }>(
        `INSERT INTO connectors (org_id, kind, name, auth_type, oauth_scopes, status, created_by)
         VALUES ($1, $2, $3, 'oauth2', $4, 'pending_auth', $5)
         RETURNING id`,
        [orgId, service, name, definition.scopes, createdBy],
      );
      return row!.id;
    } catch (error) {
      const collided = error instanceof Error && error.message.includes("connectors_org_name_key");
      if (!collided || attempt === 4) throw error;
      ordinal += 1; // another add landed on this name between our count and insert
    }
  }
  throw new Error("Could not allocate a unique connector name");
}

/**
 * Starts connecting a new Google account and returns the consent URL to visit.
 * Always creates a fresh connector row — never reuses one already connected —
 * so more than one Gmail or Calendar account can be connected at once.
 */
export async function startGoogleAuth(
  service: GoogleService,
  orgId: string,
  createdBy: string | null,
  origin: string,
  fromApp = false,
): Promise<string> {
  const id = await insertGoogleConnectorRow(service, orgId, createdBy);
  const url = await beginGoogleConsent(id, service, origin, fromApp);
  await logConnectorEvent(id, "auth", true, `Consent requested for ${GOOGLE_SERVICES[service].label}`);
  return url;
}

/**
 * Re-runs consent for a connector that already exists — used when its token
 * has expired without a refresh token, or a scope needs approving again.
 * Unlike `startGoogleAuth`, this targets one specific account rather than
 * adding another. `orgId` must match the connector's own — the guard against
 * one org re-authorizing another's connector.
 */
export async function reauthorizeGoogleConnector(
  connectorId: string,
  orgId: string,
  origin: string,
  fromApp = false,
): Promise<string> {
  const connector = await getConnector(connectorId);
  if (!connector || (connector.kind !== "google_gmail" && connector.kind !== "google_calendar")) {
    throw new Error("That connector is not a Google account");
  }

  const updated = await query(
    `UPDATE connectors SET status = 'pending_auth', status_detail = NULL, is_enabled = true
      WHERE id = $1 AND org_id = $2 RETURNING id`,
    [connectorId, orgId],
  );
  if (updated.length === 0) throw new Error("That connector is not part of your organization");

  const url = await beginGoogleConsent(connectorId, connector.kind as GoogleService, origin, fromApp);
  await logConnectorEvent(connectorId, "auth", true, `Consent re-requested for ${connector.name}`);
  return url;
}

/**
 * A sign-in's `state`. One started from the iOS app (its secure sign-in sheet) is marked with an
 * `app_` prefix, so the callback hands the result back to the app (clandar://connectors) rather than
 * the website's Connectors page.
 */
export function oauthState(fromApp: boolean): string {
  return `${fromApp ? APP_STATE_PREFIX : ""}${crypto.randomUUID()}`;
}
const APP_STATE_PREFIX = "app_";

/** Where a sign-in's callback goes when it's done: the app for an app-started one, else /connectors. */
export function oauthDoneUrl(state: string, message: string, ok: boolean, requestUrl: string): URL {
  const query = `notice=${encodeURIComponent(message)}&ok=${ok ? 1 : 0}`;
  return state.startsWith(APP_STATE_PREFIX)
    ? new URL(`clandar://connectors?${query}`)
    : new URL(`/connectors?${query}`, requestUrl);
}

export async function consumeOAuthState(
  state: string,
): Promise<{ connectorId: string; redirectUri: string | null } | null> {
  const row = await queryOne<{ connector_id: string; redirect_uri: string | null }>(
    `DELETE FROM oauth_states WHERE state = $1 AND expires_at > now()
     RETURNING connector_id, redirect_uri`,
    [state],
  );
  return row ? { connectorId: row.connector_id, redirectUri: row.redirect_uri } : null;
}

type GoogleTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

async function googleTokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const payload = (await response.json()) as GoogleTokens & { error_description?: string; error?: string };
  if (!response.ok) {
    throw new Error(payload.error_description ?? payload.error ?? `HTTP ${response.status}`);
  }
  return payload;
}

/**
 * Exchanges the authorization code and stores the tokens encrypted.
 * `redirectUri` must be the exact value sent in the authorization request —
 * Google rejects the exchange otherwise — which is why the caller passes the
 * one `consumeOAuthState` returned rather than this re-deriving its own.
 */
export async function completeGoogleAuth(connectorId: string, code: string, redirectUri: string) {
  const { clientId, clientSecret } = googleCredentials();
  const tokens = await googleTokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  await saveGoogleTokens(connectorId, tokens);
  await logConnectorEvent(connectorId, "auth", true, "Google returned an access token");

  const connector = await getConnector(connectorId);
  if (connector) await probeGoogleConnector(connector);
}

async function saveGoogleTokens(connectorId: string, tokens: GoogleTokens) {
  // Google only returns a refresh token on the first consent; keep the old one.
  const existing = await queryOne<{ secret_cipher: string | null }>(
    `SELECT secret_cipher FROM connectors WHERE id = $1`,
    [connectorId],
  );
  let refreshToken = tokens.refresh_token;
  if (!refreshToken && existing?.secret_cipher) {
    try {
      refreshToken = (JSON.parse(decryptSecret(existing.secret_cipher)) as GoogleTokens).refresh_token;
    } catch {
      refreshToken = undefined;
    }
  }

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  await query(
    `UPDATE connectors
        SET secret_cipher = $2,
            token_expires_at = $3,
            oauth_scopes = COALESCE($4, oauth_scopes),
            status = 'connected'
      WHERE id = $1`,
    [
      connectorId,
      encryptSecret(
        JSON.stringify({
          access_token: tokens.access_token,
          refresh_token: refreshToken,
          token_type: tokens.token_type ?? "Bearer",
        }),
      ),
      expiresAt,
      tokens.scope ? tokens.scope.split(" ") : null,
    ],
  );
}

/** Returns a usable access token, refreshing it when it is close to expiry. */
export async function googleAccessToken(connectorId: string): Promise<string> {
  const row = await queryOne<{ secret_cipher: string | null; token_expires_at: Date | null }>(
    `SELECT secret_cipher, token_expires_at FROM connectors WHERE id = $1`,
    [connectorId],
  );
  if (!row?.secret_cipher) throw new Error("Not connected — authorize this connector first");

  const stored = JSON.parse(decryptSecret(row.secret_cipher)) as GoogleTokens;
  const fresh =
    row.token_expires_at !== null && row.token_expires_at.getTime() - Date.now() > 60_000;
  if (fresh) return stored.access_token;

  if (!stored.refresh_token) {
    throw new Error("Access token expired and no refresh token was issued — reconnect the account");
  }
  const { clientId, clientSecret } = googleCredentials();
  const refreshed = await googleTokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: stored.refresh_token,
    grant_type: "refresh_token",
  });
  await saveGoogleTokens(connectorId, { ...refreshed, refresh_token: stored.refresh_token });
  return refreshed.access_token;
}

/**
 * Google answers a refused call with a long, specific explanation — the API not
 * being enabled for the project, or the token missing a scope. Repeating just
 * the status code hides the one thing worth reading, so the body is unpacked
 * and the two common causes get an instruction attached.
 */
export async function googleApiFailure(response: Response, api: string): Promise<string> {
  type GoogleError = {
    error?: {
      message?: string;
      status?: string;
      errors?: { reason?: string }[];
      details?: { reason?: string }[];
    };
  };

  let body: GoogleError = {};
  try {
    body = (await response.json()) as GoogleError;
  } catch {
    return `${api} returned HTTP ${response.status} with no explanation`;
  }

  const message = body.error?.message?.trim();
  const reason =
    body.error?.errors?.find((e) => e.reason)?.reason ??
    body.error?.details?.find((d) => d.reason)?.reason ??
    body.error?.status;

  if (reason === "accessNotConfigured" || reason === "SERVICE_DISABLED") {
    return `${api} is not enabled for this Google Cloud project. Enable it in the API library, wait a minute, then test again. Google said: ${message ?? "(no message)"}`;
  }
  if (reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" || reason === "insufficientPermissions") {
    return `The access token is missing the scope ${api} needs. Remove this app at myaccount.google.com/permissions, then connect again and approve the read-only request. Google said: ${message ?? "(no message)"}`;
  }
  return message ? `${api}: ${message}` : `${api} returned HTTP ${response.status}`;
}


/** Calls the smallest read endpoint each service offers, to prove the token works. */
export async function probeGoogleConnector(connector: Connector) {
  try {
    const token = await googleAccessToken(connector.id);
    const headers = { authorization: `Bearer ${token}` };

    if (connector.kind === "google_gmail") {
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(await googleApiFailure(response, "The Gmail API"));
      const profile = (await response.json()) as { emailAddress: string; messagesTotal: number };
      const detail = `${profile.emailAddress} — ${profile.messagesTotal.toLocaleString("en-US")} messages`;
      await recordCheck(connector.id, true, detail, {
        accountLabel: profile.emailAddress,
        // Once the address is known the row is renamed to show it — useful the
        // instant more than one Gmail connector exists, since "Gmail" and
        // "Gmail (2)" alone don't say which account is which.
        name: `${GOOGLE_SERVICES.google_gmail.label} — ${profile.emailAddress}`,
        metadata: { messagesTotal: profile.messagesTotal },
      });
      return { ok: true, message: detail };
    }

    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50",
      { headers, cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
    );
    if (!response.ok) throw new Error(await googleApiFailure(response, "The Google Calendar API"));
    const list = (await response.json()) as {
      items?: { id: string; summary: string; primary?: boolean }[];
    };
    const items = list.items ?? [];
    const primary = items.find((c) => c.primary) ?? items[0];
    const detail = `${primary?.summary ?? "no calendars"} — ${items.length} calendar${items.length === 1 ? "" : "s"}`;
    await recordCheck(connector.id, true, detail, {
      accountLabel: primary?.id ?? null,
      name: primary?.id ? `${GOOGLE_SERVICES.google_calendar.label} — ${primary.id}` : undefined,
      metadata: { calendars: items.length },
    });
    return { ok: true, message: detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    await recordCheck(connector.id, false, detail);
    return { ok: false, message: detail };
  }
}

/** Every enabled Gmail account in the org, for the email screen's account switcher. */
export async function listGmailConnectors(orgId: string): Promise<Connector[]> {
  const connectors = await listConnectors(orgId);
  return connectors.filter((c) => c.kind === "google_gmail" && c.enabled);
}

/** One Gmail connector by id — `null` if it doesn't exist or isn't Gmail. */
export async function getGmailConnector(id: string): Promise<Connector | null> {
  const connector = await getConnector(id);
  return connector?.kind === "google_gmail" ? connector : null;
}

export async function probeConnector(connector: Connector) {
  return connector.kind === "mcp"
    ? probeMcpConnector(connector)
    : probeGoogleConnector(connector);
}
