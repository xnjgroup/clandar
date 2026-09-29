/**
 * The Executive Assistant: a real, org-scoped, multi-conversation chat backed
 * by the org's chat LLM provider (see lib/llm-providers.ts's chatLlmProvider
 * — falls back to the org's default provider if a chat-specific one isn't
 * assigned on /settings). Unlike the
 * old single-snapshot Q&A, this one can act — it has a small set of tools
 * that read and write the org's actual data (customers, projects, project
 * types, tasks), so "here's a photo of our service list, add these as
 * project types" is a real write, not a suggestion the model can't act on.
 *
 * Tool calling is done via strict-JSON prompting rather than a provider's
 * native function-calling API: this app talks to arbitrary OpenAI-compatible
 * endpoints (local LM Studio, Ollama, hosted APIs, ...) and native tool-call
 * support is inconsistent across those. The same "reply with ONLY JSON"
 * technique is already used by lib/quoting.ts for structured estimates — this
 * just runs it in a loop, feeding each tool's result back in as context,
 * until the model chooses to reply instead of calling another tool.
 */
import { query, queryOne } from "@/lib/db";
import { chatCompleteStream, chatLlmProvider, type ChatContentPart, type ChatMessage } from "@/lib/llm-providers";
import { createCustomer, listCustomers } from "@/lib/customers";
import { createProject, listProjects, type ProjectStatus } from "@/lib/projects";
import { createProjectType, listProjectTypes } from "@/lib/project-types";
import { createTask, listTasks, type TaskKind } from "@/lib/tasks";
import { addProjectFile, addProjectPhoto } from "@/lib/project-photos";
import { readUpload, saveUpload } from "@/lib/storage";

export type AgentAttachment = { id: string; fileName: string; contentType: string };

export type AgentTurn = {
  id: string;
  role: "user" | "assistant";
  body: string;
  toolCalls: { tool: string; detail: string }[];
  attachments: AgentAttachment[];
};

export type IncomingAttachment = { name: string; mimeType: string; dataUrl: string };

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: Date;
  lastMessage: string | null;
  archived: boolean;
};

export async function listConversations(
  orgId: string,
  options: { includeArchived?: boolean } = {},
): Promise<ConversationSummary[]> {
  const rows = await query<{
    id: string;
    title: string;
    updated_at: Date;
    last_message: string | null;
    archived_at: Date | null;
  }>(
    `SELECT c.id, c.title,
            coalesce(
              (SELECT max(m.created_at) FROM agent_messages m WHERE m.conversation_id = c.id),
              c.created_at
            ) AS updated_at,
            (SELECT body FROM agent_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1)
              AS last_message,
            c.archived_at
       FROM agent_conversations c
      WHERE c.org_id = $1 ${options.includeArchived ? "" : "AND c.archived_at IS NULL"}
      ORDER BY updated_at DESC`,
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updated_at,
    lastMessage: r.last_message,
    archived: r.archived_at !== null,
  }));
}

export async function setConversationArchived(id: string, orgId: string, archived: boolean): Promise<void> {
  await query(
    `UPDATE agent_conversations SET archived_at = $3 WHERE id = $1 AND org_id = $2`,
    [id, orgId, archived ? new Date() : null],
  );
}

async function turnsFor(conversationId: string): Promise<AgentTurn[]> {
  const messages = await query<{ id: string; role: "user" | "assistant"; body: string }>(
    `SELECT id, role, body FROM agent_messages WHERE conversation_id = $1 ORDER BY created_at`,
    [conversationId],
  );
  const calls = await query<{ message_id: string; tool: string; detail: string }>(
    `SELECT c.message_id, c.tool, c.detail
       FROM agent_tool_calls c
       JOIN agent_messages m ON m.id = c.message_id
      WHERE m.conversation_id = $1
      ORDER BY c.sort_order`,
    [conversationId],
  );
  const attachments = await query<{ message_id: string; id: string; file_name: string; content_type: string }>(
    `SELECT a.message_id, a.id, a.file_name, a.content_type
       FROM agent_message_attachments a
       JOIN agent_messages m ON m.id = a.message_id
      WHERE m.conversation_id = $1
      ORDER BY a.sort_order`,
    [conversationId],
  );
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    body: m.body,
    toolCalls: calls.filter((c) => c.message_id === m.id).map((c) => ({ tool: c.tool, detail: c.detail })),
    attachments: attachments
      .filter((a) => a.message_id === m.id)
      .map((a) => ({ id: a.id, fileName: a.file_name, contentType: a.content_type })),
  }));
}

export async function getConversation(
  id: string,
  orgId: string,
): Promise<{ id: string; title: string; turns: AgentTurn[] } | null> {
  const conversation = await queryOne<{ id: string; title: string }>(
    `SELECT id, title FROM agent_conversations WHERE id = $1 AND org_id = $2`,
    [id, orgId],
  );
  if (!conversation) return null;
  return { id: conversation.id, title: conversation.title, turns: await turnsFor(conversation.id) };
}

async function createConversation(orgId: string, personId: string | null): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO agent_conversations (org_id, title, person_id) VALUES ($1, 'New conversation', $2) RETURNING id`,
    [orgId, personId],
  );
  return row!.id;
}

/* ── Tools ────────────────────────────────────────────────────
   Each tool is org-scoped by construction — every lib call below takes the
   orgId the conversation itself belongs to, never one supplied by the model.
*/

type ToolResult = { summary: string; data?: unknown };

const TOOLS: { name: string; description: string; parameters: string }[] = [
  {
    name: "list_project_types",
    description: "List this org's project types (the kinds of work it does).",
    parameters: "{}",
  },
  {
    name: "create_project_type",
    description: "Create one new project type for this org.",
    parameters: '{"name": "string, required", "icon": "optional short icon keyword, e.g. briefcase, brush, wrench, home"}',
  },
  {
    name: "create_project_types",
    description:
      "Create several new project types for this org in one call — prefer this over calling " +
      "create_project_type repeatedly whenever you're adding more than one (e.g. extracting a list from a " +
      "flyer or spreadsheet).",
    parameters:
      '{"items": [{"name": "string, required", "icon": "optional short icon keyword"}, ...]}',
  },
  { name: "list_customers", description: "List this org's customers.", parameters: "{}" },
  {
    name: "create_customer",
    description: "Create a new customer.",
    parameters: '{"name": "string, required", "email": "optional", "phone": "optional", "address": "optional"}',
  },
  {
    name: "list_projects",
    description: "List this org's projects, optionally filtered by status.",
    parameters: '{"status": "optional: lead|quoted|scheduled|in_progress|completed|cancelled"}',
  },
  {
    name: "create_project",
    description:
      "Create a new project for a customer. The customer is matched by name (case-insensitive); if none " +
      "matches, a new customer with that name is created. The project type is matched by name against this " +
      "org's existing project types (case-insensitive) — call list_project_types or create_project_type first " +
      "if the type doesn't exist yet.",
    parameters:
      '{"customerName": "string, required", "title": "string, required", "projectTypeName": "optional", ' +
      '"address": "optional", "notes": "optional"}',
  },
  { name: "list_tasks", description: "List this org's open tasks.", parameters: "{}" },
  {
    name: "create_task",
    description: "Create a to-do, shopping-list item, or permit reminder.",
    parameters:
      '{"title": "string, required", "kind": "optional: todo|shopping|permit, default todo", ' +
      '"dueDate": "optional YYYY-MM-DD", "projectTitle": "optional, matched case-insensitively"}',
  },
  {
    name: "attach_files_to_project",
    description:
      "Saves the image(s)/file(s) the user just attached to this message onto a project's own record — " +
      "photos go to its Photos & quoting section, everything else to its Files section. Only works for files " +
      "attached in the CURRENT message; there's nothing to attach if the user didn't upload anything this turn.",
    parameters: '{"projectTitle": "string, required — matched case-insensitively"}',
  },
];

async function findProjectTypeIdByName(orgId: string, name: string | undefined): Promise<string | null> {
  if (!name) return null;
  const types = await listProjectTypes(orgId);
  return types.find((t) => t.name.toLowerCase() === name.trim().toLowerCase())?.id ?? null;
}

async function findOrCreateCustomerId(orgId: string, name: string): Promise<string> {
  const existing = await listCustomers(orgId, name);
  const exact = existing.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  if (exact) return exact.id;
  return createCustomer({ orgId, name: name.trim(), email: null, phone: null, address: null, notes: "" });
}

async function findProjectIdByTitle(orgId: string, title: string | undefined): Promise<string | null> {
  if (!title) return null;
  const projects = await listProjects(orgId);
  return projects.find((p) => p.title.toLowerCase() === title.trim().toLowerCase())?.id ?? null;
}

/**
 * Runs one tool call, never throwing — any failure (a bad enum value, a
 * unique-constraint hit like a duplicate project type name, ...) comes back
 * as a tool result the model can see and react to in its next step, instead
 * of aborting the whole turn with a raw error the user would see with no
 * context under the chat input.
 */
type SavedAttachment = { filePath: string; fileName: string; contentType: string };

async function runTool(
  orgId: string,
  personId: string | null,
  name: string,
  args: Record<string, unknown>,
  currentAttachments: SavedAttachment[],
): Promise<ToolResult> {
  try {
    return await runToolUnsafe(orgId, personId, name, args, currentAttachments);
  } catch (error) {
    return { summary: `${name} failed: ${error instanceof Error ? error.message : "unknown error"}` };
  }
}

async function runToolUnsafe(
  orgId: string,
  personId: string | null,
  name: string,
  args: Record<string, unknown>,
  currentAttachments: SavedAttachment[],
): Promise<ToolResult> {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  switch (name) {
    case "list_project_types": {
      const types = await listProjectTypes(orgId);
      return { summary: `Listed ${types.length} project type(s).`, data: types };
    }
    case "create_project_type": {
      const projName = str(args.name);
      if (!projName) return { summary: "create_project_type failed: name is required." };
      const icon = str(args.icon) || "briefcase";
      try {
        const id = await createProjectType(orgId, projName, icon);
        return { summary: `Created project type "${projName}".`, data: { id, name: projName, icon } };
      } catch {
        // Most likely project_types_org_name_key — a duplicate for this org.
        return { summary: `create_project_type failed: "${projName}" already exists for this org.` };
      }
    }
    case "create_project_types": {
      const items = Array.isArray(args.items) ? (args.items as { name?: unknown; icon?: unknown }[]) : [];
      const created: { id: string; name: string; icon: string }[] = [];
      const skipped: string[] = [];
      for (const item of items) {
        const itemName = str(item.name);
        if (!itemName) continue;
        const icon = str(item.icon) || "briefcase";
        try {
          const id = await createProjectType(orgId, itemName, icon);
          created.push({ id, name: itemName, icon });
        } catch {
          skipped.push(itemName); // most likely a duplicate name for this org
        }
      }
      return {
        summary:
          `Created ${created.length} project type(s): ${created.map((c) => c.name).join(", ") || "none"}.` +
          (skipped.length > 0 ? ` Skipped (already exist): ${skipped.join(", ")}.` : ""),
        data: { created, skipped },
      };
    }
    case "list_customers": {
      const customers = await listCustomers(orgId);
      return { summary: `Listed ${customers.length} customer(s).`, data: customers };
    }
    case "create_customer": {
      const name2 = str(args.name);
      if (!name2) return { summary: "create_customer failed: name is required." };
      const id = await createCustomer({
        orgId,
        name: name2,
        email: str(args.email) || null,
        phone: str(args.phone) || null,
        address: str(args.address) || null,
        notes: "",
      });
      return { summary: `Created customer "${name2}".`, data: { id, name: name2 } };
    }
    case "list_projects": {
      const status = str(args.status) as ProjectStatus | "";
      const projects = await listProjects(orgId, status ? { status } : {});
      return { summary: `Listed ${projects.length} project(s).`, data: projects };
    }
    case "create_project": {
      const customerName = str(args.customerName);
      const title = str(args.title);
      if (!customerName || !title) {
        return { summary: "create_project failed: customerName and title are required." };
      }
      const customerId = await findOrCreateCustomerId(orgId, customerName);
      const projectTypeId = await findProjectTypeIdByName(orgId, str(args.projectTypeName) || undefined);
      const id = await createProject({
        orgId,
        customerId,
        title,
        projectTypeId,
        address: str(args.address),
        notes: str(args.notes),
        createdBy: personId,
      });
      return { summary: `Created project "${title}" for ${customerName}.`, data: { id, title } };
    }
    case "list_tasks": {
      const tasks = await listTasks(orgId);
      return { summary: `Listed ${tasks.length} open task(s).`, data: tasks };
    }
    case "create_task": {
      const title2 = str(args.title);
      if (!title2) return { summary: "create_task failed: title is required." };
      const kind = (str(args.kind) || "todo") as TaskKind;
      const projectId = await findProjectIdByTitle(orgId, str(args.projectTitle) || undefined);
      const id = await createTask({
        orgId,
        projectId,
        kind,
        title: title2,
        dueDate: str(args.dueDate) || null,
        assignedTo: null,
        createdBy: personId,
      });
      return { summary: `Created ${kind} task "${title2}".`, data: { id, title: title2 } };
    }
    case "attach_files_to_project": {
      if (currentAttachments.length === 0) {
        return { summary: "attach_files_to_project failed: no files were attached to this message." };
      }
      const projectTitle = str(args.projectTitle);
      const projectId = await findProjectIdByTitle(orgId, projectTitle);
      if (!projectId) {
        return { summary: `attach_files_to_project failed: no project found named "${projectTitle}".` };
      }
      let photoCount = 0;
      let fileCount = 0;
      for (const a of currentAttachments) {
        const bytes = await readUpload(a.filePath);
        if (a.contentType.startsWith("image/")) {
          await addProjectPhoto({ projectId, fileName: a.fileName, contentType: a.contentType, bytes, uploadedBy: personId });
          photoCount++;
        } else {
          await addProjectFile({ projectId, fileName: a.fileName, contentType: a.contentType, bytes, uploadedBy: personId });
          fileCount++;
        }
      }
      return {
        summary: `Attached ${photoCount} photo(s) and ${fileCount} file(s) to "${projectTitle}".`,
        data: { photoCount, fileCount },
      };
    }
    default:
      return { summary: `Unknown tool "${name}" — ignored.` };
  }
}

/* ── The loop ─────────────────────────────────────────────────── */

type AgentAction =
  | { type: "reply"; message: string }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> };

/**
 * Finds the first complete, balanced `{...}` object in `raw`, ignoring
 * anything before or after it. Some models tack on their own native
 * tool-call scaffolding (special tokens, a second near-duplicate JSON blob,
 * ...) after the JSON we actually asked for — a naive "first `{` to last `}`"
 * regex would swallow that trailing noise into one unparseable blob. Tracks
 * string/escape state so a brace inside a quoted value doesn't miscount.
 */
function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null; // never closed — an incomplete/malformed response
}

/**
 * Some models ignore the requested JSON envelope entirely and emit their own
 * native tool-call syntax instead — an `invoke name="..."` / `parameter
 * name="..."` XML-ish shape (seen from at least one provider even wrapped in
 * garbled/mis-decoded special-token placeholders around it, a sign of a
 * tokenizer/chat-template mismatch on that server, not something this app
 * can fix — but the invoke/parameter structure itself is recognizable
 * regardless of what garbage surrounds it). Recovered here as a fallback so
 * the call still runs instead of the raw tags showing up as a "reply".
 */
function parseNativeInvoke(raw: string): AgentAction | null {
  const invokeMatch = /invoke\s+name="([^"]+)"/.exec(raw);
  if (!invokeMatch) return null;
  const tool = invokeMatch[1];

  const argsMatch = /parameter\s+name="args"[^>]*>([\s\S]*?)<\//.exec(raw);
  if (argsMatch) {
    const jsonText = extractFirstJsonObject(argsMatch[1]) ?? argsMatch[1].trim();
    try {
      return { type: "tool_call", tool, args: JSON.parse(jsonText) as Record<string, unknown> };
    } catch {
      // fall through to per-parameter collection below
    }
  }

  // No single "args" JSON blob (or it didn't parse) — collect individual
  // <parameter name="x">value</parameter>-style entries instead.
  const args: Record<string, unknown> = {};
  const paramPattern = /parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\//g;
  let m: RegExpExecArray | null;
  while ((m = paramPattern.exec(raw)) !== null) {
    if (m[1] !== "args") args[m[1]] = m[2].trim();
  }
  return { type: "tool_call", tool, args };
}

function parseAction(raw: string): AgentAction {
  const jsonText = extractFirstJsonObject(raw);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as { type?: string; message?: string; tool?: string; args?: unknown };
      if (parsed.type === "tool_call" && typeof parsed.tool === "string") {
        return { type: "tool_call", tool: parsed.tool, args: (parsed.args as Record<string, unknown>) ?? {} };
      }
      if (parsed.type === "reply" && typeof parsed.message === "string") {
        return { type: "reply", message: parsed.message };
      }
    } catch {
      // fall through — not every model obeys the format perfectly
    }
  }
  const native = parseNativeInvoke(raw);
  if (native) return native;
  // Graceful fallback: treat anything that isn't valid tool-call JSON as a plain reply.
  return { type: "reply", message: raw.trim() };
}

const MAX_STEPS = 50;

function systemPrompt(pageContext: string | null): string {
  const toolList = TOOLS.map((t) => `- ${t.name}(${t.parameters}): ${t.description}`).join("\n");
  return (
    "You are the Executive Assistant for a small business owner's operations app (Clandar). You can answer " +
    "questions and take real actions — creating customers, projects, project types, and tasks — using the tools " +
    "below. Use a tool whenever the user asks you to look something up or create/change something; don't just " +
    "describe what you would do.\n\n" +
    "Available tools:\n" +
    toolList +
    "\n\n" +
    "Respond with ONLY JSON, no prose, no markdown fences, in exactly one of these two shapes:\n" +
    '  {"type": "tool_call", "tool": "<tool name>", "args": { ... }}\n' +
    '  {"type": "reply", "message": "<your reply to the user>"}\n' +
    "Do not use any other tool-calling format — no XML tags, no function-call blocks, no <invoke> syntax. " +
    "Only ever emit one of the two plain JSON shapes above, nothing else. " +
    "Call one tool at a time. After a tool result comes back, decide whether to call another tool or reply. " +
    "When the user attaches an image (a flyer, a service list, a job-site photo) or a document (its text is " +
    "included inline in their message, marked \"--- Attached: <filename> ---\"), read it and act on their " +
    "request using the tools available — for example, extracting a list of service categories from a flyer or a " +
    "spreadsheet and calling create_project_type once per item. Once you have enough information, always finish with a reply " +
    "summarizing what you did or answering the question — never end on a tool_call. In your reply's \"message\", " +
    "link to a page in the app whenever it's relevant using markdown link syntax, e.g. " +
    '"[Project Types](/projects/types)" — the chat renders these as clickable links. Common pages: /projects, ' +
    "/projects/types, /projects/new, /customers, /schedule, /tasks, /settings." +
    (pageContext ? `\n\nThe user is currently viewing: ${pageContext}.` : "")
  );
}

function decodeDataUrl(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

/** Progress events streamed to the client as they happen (see app/api/assistant/route.ts): a tool finishing, a slice of the final reply arriving, or the whole turn wrapping up. */
export type AssistantEvent =
  | { type: "tool_call"; tool: string; detail: string }
  | { type: "reply_delta"; text: string }
  | { type: "done"; conversationId: string }
  | { type: "error"; message: string };

/**
 * Pulls the growing value of the `"message"` field out of raw text as it
 * streams in — e.g. gets "hello wo" out of `{"type": "reply", "message":
 * "hello wo` before the JSON object is even complete. Not a general JSON
 * streaming parser, just enough string-literal handling (escapes, the
 * closing quote) to track one field safely, and gated on having already seen
 * `"type": "reply"` so a tool_call's `args` never gets mistaken for it.
 */
class StreamingReplyExtractor {
  private raw = "";
  private cursor = -1;
  private confirmedReply = false;
  private done = false;

  push(chunk: string): string {
    if (this.done) return "";
    this.raw += chunk;

    if (!this.confirmedReply) {
      if (!/"type"\s*:\s*"reply"/.test(this.raw)) return "";
      this.confirmedReply = true;
    }

    if (this.cursor === -1) {
      const markerIndex = this.raw.indexOf('"message"');
      if (markerIndex === -1) return "";
      const afterMarker = this.raw.slice(markerIndex + 9);
      const colonMatch = /^\s*:\s*"/.exec(afterMarker);
      if (!colonMatch) return "";
      this.cursor = markerIndex + 9 + colonMatch[0].length;
    }

    let decoded = "";
    let i = this.cursor;
    const escapeMap: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/" };
    while (i < this.raw.length) {
      const ch = this.raw[i];
      if (ch === "\\") {
        if (i + 1 >= this.raw.length) break; // incomplete escape — wait for more input
        const next = this.raw[i + 1];
        if (next === "u") {
          if (i + 6 > this.raw.length) break; // incomplete \uXXXX
          decoded += String.fromCharCode(parseInt(this.raw.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        decoded += escapeMap[next] ?? next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        this.done = true;
        break;
      }
      decoded += ch;
      i++;
    }
    this.cursor = i;
    return decoded;
  }
}

export async function* askAssistant(
  orgId: string,
  personId: string | null,
  conversationId: string | null,
  question: string,
  extraContext: string,
  images: string[],
  attachments: IncomingAttachment[],
  pageContext: string | null,
): AsyncGenerator<AssistantEvent> {
  const provider = await chatLlmProvider(orgId);
  if (!provider) {
    yield { type: "error", message: "No default LLM provider is configured — set one up on /settings first." };
    return;
  }

  const convId = conversationId ?? (await createConversation(orgId, personId));

  const priorRows = await query<{ role: "user" | "assistant"; body: string }>(
    `SELECT role, body FROM agent_messages WHERE conversation_id = $1 ORDER BY created_at`,
    [convId],
  );

  const userRow = await queryOne<{ id: string }>(
    `INSERT INTO agent_messages (conversation_id, role, body) VALUES ($1, 'user', $2) RETURNING id`,
    [convId, question],
  );
  let sortOrder = 0;
  const savedAttachments: { filePath: string; fileName: string; contentType: string }[] = [];
  for (const a of attachments) {
    const filePath = await saveUpload("assistant-attachments", convId, a.name, decodeDataUrl(a.dataUrl));
    await query(
      `INSERT INTO agent_message_attachments (message_id, file_path, file_name, content_type, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [userRow!.id, filePath, a.name, a.mimeType, sortOrder++],
    );
    savedAttachments.push({ filePath, fileName: a.name, contentType: a.mimeType });
  }

  // First user question of a fresh conversation becomes its title, so a
  // switcher listing multiple conversations has something to show besides
  // "New conversation" for all of them.
  const isFirstMessage = priorRows.length === 0;
  if (isFirstMessage) {
    await query(`UPDATE agent_conversations SET title = $2 WHERE id = $1`, [convId, question.slice(0, 60)]);
  }

  const questionForModel = extraContext ? `${question}\n\n${extraContext}` : question;
  const userContent: string | ChatContentPart[] =
    images.length > 0
      ? [
          { type: "text", text: questionForModel },
          ...images.map((url): ChatContentPart => ({ type: "image_url", image_url: { url } })),
        ]
      : questionForModel;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(pageContext) },
    ...priorRows.map((r) => ({ role: r.role, content: r.body }) as const),
    { role: "user", content: userContent },
  ];

  const toolCalls: { tool: string; detail: string }[] = [];
  let finalReply: string;
  try {
    let steps = 0;
    for (;;) {
      let raw = "";
      const extractor = new StreamingReplyExtractor();
      for await (const delta of chatCompleteStream(provider.id, messages, {
        timeoutMs: 120_000,
        model: provider.chatModel ?? undefined,
      })) {
        raw += delta;
        const piece = extractor.push(delta);
        if (piece) yield { type: "reply_delta", text: piece };
      }
      const action = parseAction(raw);
      if (action.type === "reply") {
        finalReply = action.message;
        break;
      }
      steps++;
      if (steps > MAX_STEPS) {
        finalReply =
          toolCalls.length > 0
            ? `I did ${toolCalls.length} thing(s) before running out of steps: ${toolCalls
                .map((c) => c.detail)
                .join(" ")} Ask me to continue if there's more to do.`
            : "I ran into trouble finishing that — try rephrasing or breaking it into smaller steps.";
        break;
      }
      messages.push({ role: "assistant", content: raw });
      const result = await runTool(orgId, personId, action.tool, action.args, savedAttachments);
      toolCalls.push({ tool: action.tool, detail: result.summary });
      yield { type: "tool_call", tool: action.tool, detail: result.summary };
      messages.push({
        role: "user",
        content: `[Tool result for ${action.tool}]: ${JSON.stringify(result.data ?? result.summary)}`,
      });
    }
  } catch (error) {
    yield {
      type: "error",
      message: error instanceof Error ? error.message : "The assistant could not answer that — try again.",
    };
    return;
  }

  const assistantRow = await queryOne<{ id: string }>(
    `INSERT INTO agent_messages (conversation_id, role, body) VALUES ($1, 'assistant', $2) RETURNING id`,
    [convId, finalReply],
  );
  let toolSortOrder = 0;
  for (const call of toolCalls) {
    await query(`INSERT INTO agent_tool_calls (message_id, tool, detail, sort_order) VALUES ($1, $2, $3, $4)`, [
      assistantRow!.id,
      call.tool,
      call.detail,
      toolSortOrder++,
    ]);
  }

  yield { type: "done", conversationId: convId };
}

/** Streams one chat attachment's bytes back — gated by its message's conversation actually belonging to the org (see app/api/assistant/attachments/[id]/route.ts). */
export async function getAttachment(
  id: string,
  orgId: string,
): Promise<{ filePath: string; fileName: string; contentType: string } | null> {
  const row = await queryOne<{ file_path: string; file_name: string; content_type: string }>(
    `SELECT a.file_path, a.file_name, a.content_type
       FROM agent_message_attachments a
       JOIN agent_messages m ON m.id = a.message_id
       JOIN agent_conversations c ON c.id = m.conversation_id
      WHERE a.id = $1 AND c.org_id = $2`,
    [id, orgId],
  );
  return row ? { filePath: row.file_path, fileName: row.file_name, contentType: row.content_type } : null;
}
