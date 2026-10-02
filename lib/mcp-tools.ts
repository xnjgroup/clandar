/**
 * The org's connected MCP servers' tools, for the assistant. Each enabled, connected MCP connector's
 * tools (saved at its last check — lib/connectors.ts) are offered as `<server>__<tool>`, minus the
 * ones switched off on the Connectors page. Calls go through the official SDK client with the
 * connector's auth (token / key / OAuth, refreshed).

 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getConnector, listConnectors, mcpAuthHeaders, probeMcpConnector, type McpToolSpec } from "@/lib/connectors";

export type McpToolRef = { connectorId: string; connectorName: string; tool: string };
type ToolResult = { summary: string; data?: unknown };

const CALL_TIMEOUT_MS = 60_000;
const STALE_AFTER_MS = 60 * 60 * 1000;

/** OpenAI-style tool names: [A-Za-z0-9_-], at most 64. */
function slug(text: string, max: number): string {
  return text.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max) || "x";
}

/** The tool definitions to offer, and how to route each name back to its server and tool. */
export async function mcpToolsForOrg(orgId: string): Promise<{
  definitions: { name: string; description: string; parameters: Record<string, unknown> }[];
  routes: Map<string, McpToolRef>;
}> {
  const definitions: { name: string; description: string; parameters: Record<string, unknown> }[] = [];
  const routes = new Map<string, McpToolRef>();
  const connectors = (await listConnectors(orgId)).filter((c) => c.kind === "mcp" && c.enabled && c.status === "connected");
  // The saved list is what the model sees (no round trip to every server per message); one older than
  // an hour is refreshed in the background, so a server's new or changed tools show up on a later message.
  for (const connector of connectors) {
    const noSpecs = !Array.isArray(connector.metadata?.tools); // checked before tool details were saved
    if (noSpecs || !connector.lastCheckedAt || Date.now() - connector.lastCheckedAt.getTime() > STALE_AFTER_MS) {
      void probeMcpConnector(connector).catch(() => {});
    }
  }
  for (const connector of connectors) {
    const specs = (Array.isArray(connector.metadata?.tools) ? connector.metadata.tools : []) as McpToolSpec[];
    const disabled = new Set((Array.isArray(connector.metadata?.disabledTools) ? connector.metadata.disabledTools : []) as string[]);
    const prefix = slug(connector.name, 20);
    for (const spec of specs) {
      if (disabled.has(spec.name)) continue;
      let name = `${prefix}__${slug(spec.name, 64 - prefix.length - 2)}`;
      for (let n = 2; routes.has(name); n++) name = `${name.slice(0, 60)}_${n}`;
      routes.set(name, { connectorId: connector.id, connectorName: connector.name, tool: spec.name });
      definitions.push({
        name,
        description:
          `[${connector.name} — connected MCP server] ` +
          (spec.description || spec.name).slice(0, 900),
        parameters: spec.inputSchema && typeof spec.inputSchema === "object" ? spec.inputSchema : { type: "object", properties: {} },
      });
    }
  }
  return { definitions, routes };
}

/** Calls one tool on its MCP server and returns its text output (trimmed). */
export async function runMcpTool(ref: McpToolRef, args: Record<string, unknown>): Promise<ToolResult> {
  const connector = await getConnector(ref.connectorId);
  if (!connector?.url || !connector.enabled) return { summary: `${ref.connectorName} isn't connected any more.` };
  const headers = await mcpAuthHeaders(connector);
  if (!headers) return { summary: `${ref.connectorName} needs signing in again — tell the user to use Sign in on the Connectors page.` };

  const client = new Client({ name: "clandar", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(connector.url), { requestInit: { headers } });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: ref.tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
    const parts = (Array.isArray(result.content) ? result.content : []) as { type: string; text?: string; resource?: { text?: string; uri?: string } }[];
    const text = parts
      .map((p) => (p.type === "text" ? p.text : p.type === "resource" ? (p.resource?.text ?? p.resource?.uri) : `[${p.type}]`))
      .filter(Boolean)
      .join("\n")
      .slice(0, 12_000);
    const structured = result.structuredContent ? JSON.stringify(result.structuredContent).slice(0, 8_000) : "";
    return {
      summary: `${result.isError ? "Error from" : "Ran"} ${ref.connectorName} · ${ref.tool}.`,
      data: { output: text || structured || "(no output)", ...(structured && text ? { structured } : {}) },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { summary: `${ref.connectorName} · ${ref.tool} failed: ${message.slice(0, 300)}` };
  } finally {
    await client.close().catch(() => {});
  }
}
