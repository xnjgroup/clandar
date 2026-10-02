/**
 * OAuth for MCP servers that sign you in (the MCP authorization spec): discovery from the server's 401
 * (protected-resource + authorization-server metadata), dynamic client registration, the browser
 * sign-in with PKCE, and token refresh — all done by the official SDK's `auth()`. This file only
 * stores its state: everything (registered client, tokens, PKCE verifier) lives encrypted in the
 * connector's `secret_cipher` as JSON, and the sign-in `state` in `oauth_states`.
 */
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { query, queryOne } from "@/lib/db";

type Stored = {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  /** When the access token expires (ms since epoch), from `expires_in` at save time. */
  expiresAt?: number;
  verifier?: string;
  redirectUrl?: string;
};

export function mcpOAuthRedirectUrl(origin: string): string {
  return `${origin}/api/connectors/mcp/callback`;
}

async function load(connectorId: string): Promise<Stored> {
  const row = await queryOne<{ secret_cipher: string | null }>(`SELECT secret_cipher FROM connectors WHERE id = $1`, [connectorId]);
  if (!row?.secret_cipher) return {};
  try {
    return JSON.parse(decryptSecret(row.secret_cipher)) as Stored;
  } catch {
    return {}; // a plain token from before — start over
  }
}

async function save(connectorId: string, change: Partial<Stored>): Promise<void> {
  const next = { ...(await load(connectorId)), ...change };
  await query(`UPDATE connectors SET secret_cipher = $2 WHERE id = $1`, [connectorId, encryptSecret(JSON.stringify(next))]);
}

/** The SDK's view of one connector: reads and writes its stored OAuth state. */
class ConnectorOAuthProvider implements OAuthClientProvider {
  /** Set by `redirectToAuthorization` — where to send the browser. */
  authorizationUrl: URL | null = null;

  constructor(
    private readonly connectorId: string,
    private readonly redirect: string,
  ) {}

  get redirectUrl() {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Clandar",
      client_uri: new URL(this.redirect).origin,
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async state(): Promise<string> {
    const state = crypto.randomUUID();
    await query(`DELETE FROM oauth_states WHERE connector_id = $1 OR expires_at < now()`, [this.connectorId]);
    await query(`INSERT INTO oauth_states (state, connector_id, redirect_uri) VALUES ($1, $2, $3)`, [
      state,
      this.connectorId,
      this.redirect,
    ]);
    return state;
  }

  async clientInformation() {
    return (await load(this.connectorId)).client;
  }
  async saveClientInformation(client: OAuthClientInformationMixed) {
    await save(this.connectorId, { client });
  }
  async tokens() {
    return (await load(this.connectorId)).tokens;
  }
  async saveTokens(tokens: OAuthTokens) {
    await save(this.connectorId, {
      tokens,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
    });
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  async saveCodeVerifier(verifier: string) {
    await save(this.connectorId, { verifier, redirectUrl: this.redirect });
  }
  async codeVerifier() {
    const verifier = (await load(this.connectorId)).verifier;
    if (!verifier) throw new Error("No sign-in in progress — start it again.");
    return verifier;
  }
}

/**
 * Starts signing in to an MCP server: discovers its authorization server, registers Clandar with it
 * when needed, and returns where to send the browser — or null when it's already signed in (a
 * refresh token was enough). Throws when the server doesn't do OAuth.
 */
export async function startMcpOAuth(connectorId: string, serverUrl: string, origin: string): Promise<URL | null> {
  const provider = new ConnectorOAuthProvider(connectorId, mcpOAuthRedirectUrl(origin));
  const result = await auth(provider, { serverUrl });
  return result === "REDIRECT" ? provider.authorizationUrl : null;
}

/** The browser came back with a code: exchange it for tokens. */
export async function completeMcpOAuth(connectorId: string, serverUrl: string, code: string, redirectUrl: string): Promise<void> {
  const provider = new ConnectorOAuthProvider(connectorId, redirectUrl);
  const result = await auth(provider, { serverUrl, authorizationCode: code });
  if (result !== "AUTHORIZED") throw new Error("The server didn't accept the sign-in.");
  await save(connectorId, { verifier: undefined });
}

/**
 * A current access token for an OAuth MCP connector — refreshed when it's (nearly) expired. Null when
 * there's none and signing in again is needed.
 */
export async function mcpAccessToken(connectorId: string, serverUrl: string): Promise<string | null> {
  const stored = await load(connectorId);
  if (!stored.tokens) return null;
  const fresh = !stored.expiresAt || stored.expiresAt - Date.now() > 60_000;
  if (fresh) return stored.tokens.access_token;
  if (!stored.tokens.refresh_token || !stored.redirectUrl) return null;
  const provider = new ConnectorOAuthProvider(connectorId, stored.redirectUrl);
  try {
    const result = await auth(provider, { serverUrl });
    if (result !== "AUTHORIZED") return null;
  } catch {
    return null;
  }
  return (await load(connectorId)).tokens?.access_token ?? null;
}
