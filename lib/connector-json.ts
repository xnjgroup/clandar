import type { Connector } from "@/lib/connectors";

/** A connector as the app shows it — its tools with their on/off state, never its secret. */
export function connectorJson(c: Connector) {
  const disabled = new Set((Array.isArray(c.metadata?.disabledTools) ? c.metadata.disabledTools : []) as string[]);
  const google = c.kind === "google_gmail" || c.kind === "google_calendar";
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    url: c.url,
    authType: c.authType,
    accountLabel: c.accountLabel,
    enabled: c.enabled,
    status: c.status,
    statusDetail: c.statusDetail,
    toolCount: c.toolCount,
    lastCheckedAt: c.lastCheckedAt,
    // Reconnect (Google) / Sign in (an MCP server with OAuth, or one that answered 401).
    canSignIn: google || (c.kind === "mcp" && (c.authType === "oauth2" || /\b401\b/.test(c.statusDetail ?? ""))),
    tools: c.kind === "mcp" ? c.tools.map((t) => ({ name: t.name, description: t.description, enabled: !disabled.has(t.name) })) : [],
  };
}
