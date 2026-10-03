/**
 * OAuth 2.1 for Clandar's own MCP server (/mcp), per the MCP authorization spec: Clandar is the
 * authorization server. An AI agent registers itself (dynamic client registration), sends the person
 * to /oauth/authorize — Clandar's normal sign-in, then an "Allow access" screen — and exchanges the
 * code (PKCE S256 only) for an access token and a refresh token. Tokens are random strings stored only
 * as SHA-256 hashes; refresh tokens rotate on use. Everything the agent does runs as the approving
 * person, in their org, with their role. A person can see and revoke connected agents in Settings.
 */
import { createHash, randomBytes } from "node:crypto";
import { query, queryOne } from "@/lib/db";

const ACCESS_TTL_SECONDS = 60 * 60; // 1 hour
const CODE_TTL_SECONDS = 5 * 60;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/* ── Clients (dynamic registration, RFC 7591) ─────────────── */

export type McpClient = { clientId: string; clientName: string; redirectUris: string[] };

/** A loopback http redirect (an agent listening on this computer). */
function isLoopback(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.hash;
  } catch {
    return false;
  }
}

/** Only https redirect URIs, or loopback http (desktop / CLI agents listening locally). */
function validRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    // Native apps' private schemes (e.g. cursor://, vscode://) — but never javascript:/data:.
    return /^[a-z][a-z0-9+.-]*:$/i.test(url.protocol) && !["javascript:", "data:", "file:", "vbscript:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export async function registerClient(input: { client_name?: unknown; redirect_uris?: unknown }): Promise<McpClient> {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (uris.length === 0 || uris.length > 10 || !uris.every(validRedirectUri)) {
    throw new OAuthError("invalid_redirect_uri", "Give one or more https (or loopback http) redirect_uris.");
  }
  const name = (typeof input.client_name === "string" && input.client_name.trim() ? input.client_name.trim() : "AI agent").slice(0, 80);
  const clientId = `clmcp-${randomBytes(16).toString("hex")}`;
  await query(`INSERT INTO mcp_clients (client_id, client_name, redirect_uris) VALUES ($1, $2, $3)`, [clientId, name, uris]);
  return { clientId, clientName: name, redirectUris: uris };
}

export async function getClient(clientId: string): Promise<McpClient | null> {
  const row = await queryOne<{ client_id: string; client_name: string; redirect_uris: string[] }>(
    `SELECT client_id, client_name, redirect_uris FROM mcp_clients WHERE client_id = $1`,
    [clientId],
  );
  return row ? { clientId: row.client_id, clientName: row.client_name, redirectUris: row.redirect_uris } : null;
}

/* ── Authorization codes ───────────────────────────────────── */

/** The person approved: a one-time code for the agent (sent to its redirect URI). */
export async function createAuthCode(input: {
  clientId: string;
  personId: string;
  orgId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string | null;
}): Promise<string> {
  const code = token("clcode");
  await query(
    `INSERT INTO mcp_auth_codes (code_hash, client_id, person_id, org_id, redirect_uri, code_challenge, resource, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8))`,
    [sha256(code), input.clientId, input.personId, input.orgId, input.redirectUri, input.codeChallenge, input.resource, CODE_TTL_SECONDS],
  );
  return code;
}

export type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

/** A new pair of tokens for a grant (both previous ones stop working). */
async function issueTokens(grantId: string): Promise<TokenResponse> {
  const access = token("clat");
  const refresh = token("clrt");
  await query(
    `UPDATE mcp_grants SET access_hash = $2, access_expires_at = now() + make_interval(secs => $3), refresh_hash = $4 WHERE id = $1`,
    [grantId, sha256(access), ACCESS_TTL_SECONDS, sha256(refresh)],
  );
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_SECONDS, refresh_token: refresh, scope: "clandar" };
}

/**
 * An agent Clandar doesn't know (e.g. one still holding a registration from an older server at this
 * address): `invalid_client` (401) tells MCP clients to drop their stored registration and register
 * again, instead of retrying the same client.
 */
async function requireKnownClient(clientId: string): Promise<void> {
  if (!clientId || !(await getClient(clientId))) {
    throw new OAuthError("invalid_client", "Unknown client — register again (POST /oauth/register).", 401);
  }
}

/** grant_type=authorization_code: the code, used once, with its PKCE verifier and the same redirect URI. */
export async function exchangeCode(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string }): Promise<TokenResponse> {
  await requireKnownClient(input.clientId);
  const row = await queryOne<{ client_id: string; person_id: string; org_id: string; redirect_uri: string; code_challenge: string }>(
    `DELETE FROM mcp_auth_codes WHERE code_hash = $1 AND expires_at > now()
     RETURNING client_id, person_id, org_id, redirect_uri, code_challenge`,
    [sha256(input.code)],
  );
  if (!row || row.client_id !== input.clientId) throw new OAuthError("invalid_grant", "The code is invalid, expired or already used.");
  if (row.redirect_uri !== input.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri doesn't match the authorization request.");
  const challenge = createHash("sha256").update(input.codeVerifier).digest("base64url");
  if (!input.codeVerifier || challenge !== row.code_challenge) throw new OAuthError("invalid_grant", "PKCE verification failed.");
  const grant = await queryOne<{ id: string }>(
    `INSERT INTO mcp_grants (client_id, person_id, org_id) VALUES ($1, $2, $3) RETURNING id`,
    [row.client_id, row.person_id, row.org_id],
  );
  return issueTokens(grant!.id);
}

/** grant_type=refresh_token: rotates — the old refresh token stops working. */
export async function refreshTokens(input: { refreshToken: string; clientId: string }): Promise<TokenResponse> {
  await requireKnownClient(input.clientId);
  const grant = await queryOne<{ id: string; client_id: string }>(
    `SELECT g.id, g.client_id FROM mcp_grants g
       JOIN people p ON p.id = g.person_id
      WHERE g.refresh_hash = $1 AND g.revoked_at IS NULL`,
    [sha256(input.refreshToken)],
  );
  if (!grant || grant.client_id !== input.clientId) throw new OAuthError("invalid_grant", "The refresh token is invalid or was revoked.");
  return issueTokens(grant.id);
}

/** RFC 7009: revoking either token disconnects the grant. Unknown tokens are fine (no error). */
export async function revokeToken(value: string): Promise<void> {
  const hash = sha256(value);
  await query(`UPDATE mcp_grants SET revoked_at = now() WHERE (access_hash = $1 OR refresh_hash = $1) AND revoked_at IS NULL`, [hash]);
}

/* ── Checking an access token (every /mcp request) ─────────── */

export type McpCaller = { grantId: string; personId: string; orgId: string; clientName: string; conversationId: string | null };

export async function verifyAccessToken(value: string): Promise<McpCaller | null> {
  const row = await queryOne<{ id: string; person_id: string; org_id: string; client_name: string; conversation_id: string | null }>(
    `UPDATE mcp_grants g SET last_used_at = now()
       FROM mcp_clients c
      WHERE g.access_hash = $1 AND g.access_expires_at > now() AND g.revoked_at IS NULL AND c.client_id = g.client_id
        AND EXISTS (SELECT 1 FROM people p WHERE p.id = g.person_id AND p.org_id = g.org_id)
      RETURNING g.id, g.person_id, g.org_id, c.client_name, g.conversation_id`,
    [sha256(value)],
  );
  return row
    ? { grantId: row.id, personId: row.person_id, orgId: row.org_id, clientName: row.client_name, conversationId: row.conversation_id }
    : null;
}

/**
 * The grant's hidden conversation — where its confirm-first actions (e.g. a discussion comment's
 * preview, then the confirmed post) are recorded, the same way the in-app chat does it. Archived, so
 * it never shows in the chat's list.
 */
export async function grantConversation(caller: McpCaller): Promise<string> {
  if (caller.conversationId) return caller.conversationId;
  const conv = await queryOne<{ id: string }>(
    `INSERT INTO agent_conversations (org_id, person_id, title, archived_at) VALUES ($1, $2, $3, now()) RETURNING id`,
    [caller.orgId, caller.personId, `${caller.clientName} (MCP)`],
  );
  await query(`UPDATE mcp_grants SET conversation_id = $2 WHERE id = $1`, [caller.grantId, conv!.id]);
  return conv!.id;
}

/* ── Settings: connected agents ───────────────────────────── */

export type ConnectedAgent = { id: string; clientName: string; createdAt: Date; lastUsedAt: Date | null };

export async function listConnectedAgents(personId: string): Promise<ConnectedAgent[]> {
  const rows = await query<{ id: string; client_name: string; created_at: Date; last_used_at: Date | null }>(
    `SELECT g.id, c.client_name, g.created_at, g.last_used_at FROM mcp_grants g JOIN mcp_clients c ON c.client_id = g.client_id
      WHERE g.person_id = $1 AND g.revoked_at IS NULL ORDER BY g.created_at DESC`,
    [personId],
  );
  return rows.map((r) => ({ id: r.id, clientName: r.client_name, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

export async function revokeGrant(id: string, personId: string): Promise<void> {
  await query(`UPDATE mcp_grants SET revoked_at = now() WHERE id = $1 AND person_id = $2 AND revoked_at IS NULL`, [id, personId]);
}

/* ── The authorization request ─────────────────────────────── */

export type AuthorizeRequest = {
  client: McpClient;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  resource: string | null;
};

/**
 * Checks an /oauth/authorize request. An unknown client or a redirect URI it didn't register is
 * shown as an error on our page (never redirected — that would be an open redirect); other problems
 * go back to the agent as an OAuth error.
 */
export async function checkAuthorizeRequest(
  params: Record<string, string | undefined>,
): Promise<{ ok: AuthorizeRequest } | { fatal: string } | { redirect: string }> {
  let client = params.client_id ? await getClient(params.client_id) : null;
  // A desktop / command-line agent still holding a registration from an older server at this address
  // (e.g. Claude Code): when its return address is on this computer (loopback — RFC 8252), adopt the
  // client id it has, so it can connect. The code can only go back to a program on the same machine.
  if (!client && params.client_id && /^[\w.-]{8,100}$/.test(params.client_id) && params.redirect_uri && isLoopback(params.redirect_uri)) {
    await query(
      `INSERT INTO mcp_clients (client_id, client_name, redirect_uris) VALUES ($1, $2, $3) ON CONFLICT (client_id) DO NOTHING`,
      [params.client_id, "AI agent on this computer", [params.redirect_uri]],
    );
    client = await getClient(params.client_id);
  }
  if (!client) {
    return {
      fatal:
        "This app is using a sign-in it saved for an older Clandar server. In the app, clear the saved " +
        "authentication for this server (in Claude Code: /mcp → clandar → Clear authentication), then connect again.",
    };
  }
  const redirectUri = params.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  // Loopback addresses may come back on a different port each time (RFC 8252 §7.3).
  const samePlace = (a: string, b: string) => {
    if (a === b) return true;
    if (!isLoopback(a) || !isLoopback(b)) return false;
    const [x, y] = [new URL(a), new URL(b)];
    return x.hostname === y.hostname && x.pathname === y.pathname;
  };
  if (!client.redirectUris.some((u) => samePlace(u, redirectUri))) return { fatal: "This app's return address doesn't match what it registered." };
  const back = (error: string, description: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (params.state) url.searchParams.set("state", params.state);
    return { redirect: url.toString() };
  };
  if (params.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
  if (!params.code_challenge || params.code_challenge_method !== "S256") return back("invalid_request", "PKCE with S256 is required.");
  return { ok: { client, redirectUri, codeChallenge: params.code_challenge, state: params.state ?? null, resource: params.resource ?? null } };
}
