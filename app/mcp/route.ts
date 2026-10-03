import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { NextResponse } from "next/server";
import { AGENT_INSTRUCTIONS, agentToolDefinitions, runAgentTool } from "@/lib/assistant";
import { query, queryOne } from "@/lib/db";
import { CORS_HEADERS } from "@/lib/mcp-server-metadata";
import { grantConversation, verifyAccessToken, type McpCaller } from "@/lib/mcp-server-auth";
import { originFromHeaders } from "@/lib/request-origin";

/**
 * Clandar as a remote MCP server (Streamable HTTP, stateless): other AI agents use the same tools as
 * Clandar's own chat, as the person who connected them (OAuth — lib/mcp-server-auth.ts), in their org.
 * Each request builds its server for that caller; nothing is kept between requests.
 */
export const maxDuration = 300;

const withCors = (response: Response) => {
  for (const [k, v] of Object.entries(CORS_HEADERS)) response.headers.set(k, v);
  return response;
};

/** The person's time zone, as best we know it (their latest task's), for dates and times in tools. */
async function timeZoneFor(personId: string): Promise<string> {
  const row = await queryOne<{ time_zone: string }>(
    `SELECT time_zone FROM tasks WHERE created_by = $1 AND time_zone <> 'UTC' ORDER BY created_at DESC LIMIT 1`,
    [personId],
  );
  return row?.time_zone ?? "UTC";
}

/** Links in results are relative to Clandar's site — an outside agent needs them whole. */
function absoluteLinks(value: unknown, origin: string): unknown {
  return JSON.parse(JSON.stringify(value ?? null), (key, v) =>
    typeof v === "string" && (key === "link" || key === "url") && v.startsWith("/") && !v.startsWith("//") ? `${origin}${v}` : v,
  );
}

function buildServer(caller: McpCaller, origin: string): Server {
  const server = new Server({ name: "clandar", version: "1.0.0" }, { capabilities: { tools: {} }, instructions: AGENT_INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: agentToolDefinitions().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: "object", ...(t.parameters as Record<string, unknown>) } as { type: "object" },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const conversationId = await grantConversation(caller);
    // A confirm-first action's second call is the person's yes, relayed by their agent — recorded the
    // way the chat records the person's reply, so the preview → confirm check is the same one.
    if (args.confirm === true) {
      await query(`INSERT INTO agent_messages (conversation_id, role, body, person_id) VALUES ($1, 'user', $2, $3)`, [
        conversationId,
        `Confirmed through ${caller.clientName}.`,
        caller.personId,
      ]);
    }
    const result = await runAgentTool(caller.orgId, caller.personId, name, args, { timeZone: await timeZoneFor(caller.personId), conversationId });
    const failed = /^\S+ (failed|stopped)\b/.test(result.summary) || result.summary.startsWith("Unknown tool");
    const payload = result.data === undefined ? { summary: result.summary } : { summary: result.summary, data: absoluteLinks(result.data, origin) };
    return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], isError: failed };
  });

  return server;
}

async function handle(request: Request): Promise<Response> {
  const origin = originFromHeaders(request.headers);
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim();
  const caller = bearer ? await verifyAccessToken(bearer) : null;
  if (!caller) {
    // Tells the client where to find the authorization server (RFC 9728) — it then signs the person in.
    return withCors(
      NextResponse.json(
        { error: "invalid_token", error_description: bearer ? "The access token is invalid or expired." : "Sign in to connect to Clandar." },
        {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"${bearer ? ', error="invalid_token"' : ""}`,
          },
        },
      ),
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = buildServer(caller, origin);
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(request, { authInfo: { token: bearer!, clientId: caller.clientName, scopes: ["clandar"] } }));
  } finally {
    await server.close().catch(() => {});
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
