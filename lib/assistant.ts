/**
 * The assistant (named per org — Hermes by default): a real, org-scoped, multi-conversation chat backed
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
import {
  chatLlmProvider,
  chatStreamWithTools,
  type ChatContentPart,
  type ModelToolCall,
  type ToolChatMessage,
} from "@/lib/llm-providers";
import { createCustomer, findOrCreateCustomer, listCustomers } from "@/lib/customers";
import { createProject, getProject, listProjects, type ProjectStatus } from "@/lib/projects";
import { analyzeProjectPhotos, createEstimate, type LineItemKind } from "@/lib/quoting";
import { createProjectType, listProjectTypes } from "@/lib/project-types";
import { createTask, listTasks, type TaskKind } from "@/lib/tasks";
import { addProjectFile, addProjectPhoto, listProjectPhotos } from "@/lib/project-photos";
import { readUpload, saveUpload } from "@/lib/storage";
import { listTeam } from "@/lib/auth";
import { emailContextBlock, type EmailAttachmentContent } from "@/lib/email-context";
import { dateInZone, zonedTimeToUtc } from "@/lib/time-zone";
import { directionsUrl, drivingRoute, findPlace, geocodePause, milesBetween, type Place } from "@/lib/geocode";
import { countMatches, createDraft, listMail, replyContext, sendMail, type MailDetail } from "@/lib/gmail";
import { hasGmailModifyScope, listGmailConnectors, type Connector } from "@/lib/connectors";
import { BULK_TRASH_CAP } from "@/lib/gmail-cleanup";
import { enqueueTrashSearch } from "@/lib/queue";
import { listInvoiceDocuments, recordInvoiceFromEmail, setInvoiceProject } from "@/lib/email-invoice";
import { invoiceDetail } from "@/lib/queries";
import { copyEmailAttachmentsToProject } from "@/lib/email-to-project";
import {
  createScheduleEntry,
  deleteScheduleEntry,
  getScheduleEntry,
  listSchedule,
  updateScheduleEntry,
  type ScheduleEntry,
} from "@/lib/schedule";

/** What the user is looking at, beyond the page title: the open email (if any) and their time zone for dates. */
export type AssistantContext = {
  email: MailDetail | null;
  /** What was loaded from the email's attachments for the model to see/read (lib/email-context.ts). */
  emailAttachments?: EmailAttachmentContent;
  timeZone: string;
  /** Aborted when the person presses Stop (the browser drops the request): the turn ends where it is. */
  signal?: AbortSignal;
};

export type AgentAttachment = { id: string; fileName: string; contentType: string };

export type AgentTurn = {
  id: string;
  role: "user" | "assistant";
  body: string;
  /** Who sent a user message (several team members can share a conversation); null for the assistant. */
  senderId: string | null;
  senderName: string | null;
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
  const messages = await query<{
    id: string;
    role: "user" | "assistant";
    body: string;
    person_id: string | null;
    sender_name: string | null;
  }>(
    `SELECT m.id, m.role, m.body, m.person_id, p.name AS sender_name
       FROM agent_messages m LEFT JOIN people p ON p.id = m.person_id
      WHERE m.conversation_id = $1 ORDER BY m.created_at`,
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
    senderId: m.person_id,
    senderName: m.sender_name,
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

/**
 * Starts a conversation whose first message is from the assistant — how an
 * automation's report (a daily briefing) arrives, so the person can reply and
 * talk it through with the report as context. Returns the conversation id.
 */
export async function postAssistantConversation(input: {
  orgId: string;
  personId: string | null;
  title: string;
  body: string;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO agent_conversations (org_id, title, person_id) VALUES ($1, $2, $3) RETURNING id`,
    [input.orgId, input.title.slice(0, 60), input.personId],
  );
  await query(`INSERT INTO agent_messages (conversation_id, role, body) VALUES ($1, 'assistant', $2)`, [
    row!.id,
    input.body,
  ]);
  return row!.id;
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

/** JSON Schema for a tool's arguments, as the model's native tool calling expects. */
type JsonSchema = Record<string, unknown>;
const str = (description?: string): JsonSchema => ({ type: "string", ...(description ? { description } : {}) });
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const PROJECT_TITLE = str("The project's title, matched case-insensitively");

/**
 * The tools offered to the model through its native tool calling. `emailOnly`
 * tools act on the email the user has open, so they're only offered on an email page.
 */
const TOOLS: { name: string; description: string; parameters: JsonSchema; emailOnly?: boolean }[] = [
  {
    name: "list_project_types",
    description: "List this org's project types (the kinds of work it does).",
    parameters: obj({}),
  },
  {
    name: "create_project_type",
    description: "Create one new project type for this org.",
    parameters: obj({ name: str(), icon: str("Optional short icon keyword, e.g. briefcase, brush, wrench, home") }, ["name"]),
  },
  {
    name: "create_project_types",
    description:
      "Create several new project types in one call — prefer this over create_project_type whenever adding more " +
      "than one (e.g. a list extracted from a flyer or spreadsheet).",
    parameters: obj(
      { items: { type: "array", items: obj({ name: str(), icon: str("Optional short icon keyword") }, ["name"]) } },
      ["items"],
    ),
  },
  { name: "list_customers", description: "List this org's customers.", parameters: obj({}) },
  {
    name: "create_customer",
    description:
      "Create a customer — or, if one with the same email (or name) already exists, reuse it and fill in any missing " +
      "contact details. create_project also does this on its own; call this first only to save extra details like an address.",
    parameters: obj({ name: str(), email: str(), phone: str(), address: str() }, ["name"]),
  },
  {
    name: "list_projects",
    description: "List this org's projects, optionally filtered by status.",
    parameters: obj({
      status: { type: "string", enum: ["lead", "quoted", "scheduled", "in_progress", "completed", "cancelled"] },
    }),
  },
  {
    name: "create_project",
    description:
      "Create a new project for a customer. The customer is found by email, then name, or created. The project type " +
      "is matched by name against this org's project types — call list_project_types or create_project_type first if needed.",
    parameters: obj(
      {
        customerName: str(),
        title: str(),
        customerEmail: str("Set it when known (e.g. the sender of an email), so a quote can be sent"),
        customerPhone: str(),
        projectTypeName: str(),
        address: str(),
        notes: str(),
        dueDate: str("YYYY-MM-DD"),
      },
      ["customerName", "title"],
    ),
  },
  { name: "list_tasks", description: "List this org's open tasks.", parameters: obj({}) },
  {
    name: "create_task",
    description: "Create a to-do (with optional checklist steps), a shopping list (with optional items), or a reminder.",
    parameters: obj(
      {
        title: str(),
        kind: { type: "string", enum: ["todo", "shopping", "reminder"], description: "Defaults to todo" },
        notes: str(),
        items: { type: "array", items: { type: "string" }, description: "Checklist steps or shopping items" },
        dueDate: str("YYYY-MM-DD"),
        projectTitle: PROJECT_TITLE,
      },
      ["title"],
    ),
  },
  {
    name: "attach_files_to_project",
    description:
      "Save the image(s)/file(s) the user attached to THIS message onto a project — photos to its photos, " +
      "everything else to its Files. Only works for files attached in the current message.",
    parameters: obj({ projectTitle: PROJECT_TITLE }, ["projectTitle"]),
  },
  {
    name: "draft_estimate_from_photos",
    description:
      "Have the AI draft a quote (estimate) for a project from its photos, saved as a DRAFT for the user to review, " +
      "edit and send. The project needs at least one photo. Nothing is sent to the customer.",
    parameters: obj({ projectTitle: PROJECT_TITLE }, ["projectTitle"]),
  },
  {
    name: "create_estimate",
    description:
      "Save a quote (estimate) you've worked out — from the user's instructions or an email — as a DRAFT on a project " +
      "for the user to review, edit and send. Nothing is sent to the customer.",
    parameters: obj(
      {
        projectTitle: PROJECT_TITLE,
        summary: str("Scope of work the customer will read"),
        lineItems: {
          type: "array",
          items: obj(
            {
              description: str(),
              quantity: { type: "number" },
              unitPrice: { type: "number" },
              kind: { type: "string", enum: ["labor", "material", "other"] },
            },
            ["description", "quantity", "unitPrice", "kind"],
          ),
        },
      },
      ["projectTitle", "lineItems"],
    ),
  },
  {
    name: "list_invoices",
    description:
      "Search this org's invoices/receipts (bills it received). Filters are optional and combine; returns vendor, date, " +
      "due date, amount, status, linked project and a link, newest first, plus the count and total.",
    parameters: obj({
      search: str("Matches vendor, category, account number or amount"),
      status: { type: "string", enum: ["extracted", "pending_review", "flagged", "approved", "rejected"] },
      projectTitle: str("Only invoices linked to this project (matched case-insensitively)"),
      from: str("Invoice date on/after, YYYY-MM-DD"),
      to: str("Invoice date on/before, YYYY-MM-DD"),
      limit: { type: "number", description: "Max results, default 25, at most 50" },
    }),
  },
  {
    name: "get_invoice",
    description:
      "One invoice's full details — vendor, dates, amount, status, account, payment method, line items, source documents, " +
      "linked project and page link. Use an id from list_invoices.",
    parameters: obj({ invoiceId: str("The invoice id") }, ["invoiceId"]),
  },
  {
    name: "link_invoice_to_project",
    description: "Link an invoice to a project (its spend then counts toward that project), or unlink it with an empty projectTitle.",
    parameters: obj({ invoiceId: str(), projectTitle: str("The project's title; empty to unlink") }, ["invoiceId", "projectTitle"]),
  },
  {
    name: "create_schedule_entry",
    description:
      "Add a block to the schedule (calendar): what's happening, a date and time window, optionally on a project and assigned to a team member. Use it for project work days and for anything else with a time — a trip, an appointment. Times are the user's local time.",
    parameters: obj(
      {
        notes: str("What's happening, e.g. \"Tile install\" or \"Flight to Nashville\""),
        projectTitle: str("The project it's for, if any — leave out for non-project events"),
        date: str("YYYY-MM-DD"),
        startTime: str("HH:MM, 24-hour"),
        endTime: str("HH:MM, 24-hour"),
        assigneeName: str("A team member's name"),
        location: str("Where it happens — an address or place name. Leave out if it's at the project's address."),
      },
      ["notes", "date", "startTime", "endTime"],
    ),
  },
  {
    name: "list_schedule",
    description:
      "List schedule (calendar) entries in a date range, oldest first: id, what's happening, where, date and times " +
      "(user's local time), project and who's assigned. Use it to find an entry's id before editing or removing it.",
    parameters: obj({
      from: str("YYYY-MM-DD, default today"),
      to: str("YYYY-MM-DD, default 30 days after from"),
      projectTitle: str("Only this project's entries"),
    }),
  },
  {
    name: "update_schedule_entry",
    description:
      "Change a schedule entry (id from list_schedule). Only the fields you pass change: what's happening, where " +
      "(an address or place name; empty string = the project's address), date, start/end time (user's local time), " +
      "who (empty string = anyone), project (empty string = no project).",
    parameters: obj(
      {
        entryId: str("The entry id"),
        notes: str("What's happening"),
        location: str("Where it happens"),
        date: str("YYYY-MM-DD"),
        startTime: str("HH:MM, 24-hour"),
        endTime: str("HH:MM, 24-hour"),
        assigneeName: str("A team member's name, or empty for anyone"),
        projectTitle: str("The project it's for, or empty for none"),
      },
      ["entryId"],
    ),
  },
  {
    name: "delete_schedule_entry",
    description: "Remove a schedule entry (id from list_schedule). Confirm with the user first.",
    parameters: obj({ entryId: str("The entry id") }, ["entryId"]),
  },
  {
    name: "search_email",
    description:
      "Search the connected Gmail mailbox(es) with Gmail search syntax — e.g. \"category:promotions -category:updates\", " +
      "\"from:newsletter@example.com older_than:1y\", \"has:attachment larger:5M\". Returns, per mailbox, the exact number " +
      `of matching emails (counted up to ${BULK_TRASH_CAP.toLocaleString("en-US")}) and a few examples (sender, subject, date). ` +
      "Spam and Trash aren't searched unless the query says in:spam / in:trash. Searches ONE mailbox: when more " +
      "than one is connected and the user hasn't said which, ask them first (call this without an account to get " +
      "the list).",
    parameters: obj(
      {
        query: str("Gmail search syntax"),
        account: str("The mailbox's email address, as the user chose it"),
      },
      ["query"],
    ),
  },
  {
    name: "trash_email_search",
    description:
      "Move every email matching a Gmail search in ONE mailbox to Trash (Gmail keeps Trash 30 days), as a background " +
      `job of up to ${BULK_TRASH_CAP.toLocaleString("en-US")} emails with live progress in the Updates panel. ONLY after: ` +
      "(1) search_email with this exact query, (2) telling the user the mailbox, the count and a few examples, and " +
      "(3) the user explicitly confirming. Pass the count they confirmed as expectedCount — if the mailbox no longer " +
      "matches it, nothing is trashed and you must re-confirm.",
    parameters: obj(
      {
        query: str("The exact Gmail search the user confirmed"),
        account: str("The mailbox's email address (from search_email)"),
        expectedCount: { type: "number", description: "The number of emails the user confirmed" },
      },
      ["query", "account", "expectedCount"],
    ),
  },
  {
    name: "find_place",
    description:
      "Look up an address or place name on the map (OpenStreetMap): its full address and coordinates. " +
      "Add a city or state to the query if a name is ambiguous.",
    parameters: obj({ query: str("An address or place name, e.g. \"Home Depot, Jersey City NJ\"") }, ["query"]),
  },
  {
    name: "get_route",
    description:
      "Driving distance and time between two or more places, in order (addresses or place names, or a project's " +
      "address), with each leg, the straight-line distance, and a Google Maps directions link. Use it for any " +
      "\"how far\" or \"how long to drive\" question. Times are typical, without live traffic.",
    parameters: obj(
      {
        places: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 8,
          description: "The stops in order, e.g. [\"Newark airport\", \"123 Main St, Brooklyn NY\"]",
        },
      },
      ["places"],
    ),
  },
  {
    name: "draft_email_reply",
    description:
      "Save a reply to the email the user is viewing into their Gmail Drafts (threaded, addressed to the sender). Nothing is sent.",
    parameters: obj({ body: str("The full reply text, signed off naturally") }, ["body"]),
    emailOnly: true,
  },
  {
    name: "attach_email_files_to_project",
    description:
      "Copy the attachments of the email the user is viewing onto a project — images to its photos, everything else to its " +
      "Files. Use after creating a project from an email, or whenever asked to save the email's files to a project.",
    parameters: obj(
      {
        projectTitle: PROJECT_TITLE,
        attachmentNames: { type: "array", items: { type: "string" }, description: "Filenames; omit to copy all" },
      },
      ["projectTitle"],
    ),
    emailOnly: true,
  },
  {
    name: "record_email_invoice",
    description:
      "Add the invoice/bill/receipt in the email the user is viewing to their invoice records: reads the attached " +
      "PDF/image (or the email text), creates the invoice for review, and keeps the attachment and the original email as " +
      "its documents. ONLY after the user has said yes to recording it.",
    parameters: obj(
      {
        docType: { type: "string", enum: ["invoice", "receipt"] },
        projectTitle: str("Optional — link it to this project (matched case-insensitively)"),
        attachmentName: str("Optional — which attachment to read, if there are several"),
      },
      ["docType"],
    ),
    emailOnly: true,
  },
  {
    name: "send_email_reply",
    description:
      "Send a reply to the email the user is viewing, to its sender, in the same thread. ONLY when the user has " +
      "explicitly told you to send it in this chat — otherwise use draft_email_reply.",
    parameters: obj({ body: str("The full reply text") }, ["body"]),
    emailOnly: true,
  },
];

async function findProjectTypeIdByName(orgId: string, name: string | undefined): Promise<string | null> {
  if (!name) return null;
  const types = await listProjectTypes(orgId);
  return types.find((t) => t.name.toLowerCase() === name.trim().toLowerCase())?.id ?? null;
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

/** A Gmail account as the model names it: its address. */
function accountName(c: Connector): string {
  return c.accountLabel ?? c.name;
}
function matchesAccount(c: Connector, text: string): boolean {
  const t = text.trim().toLowerCase();
  return Boolean(t) && (c.accountLabel?.toLowerCase() === t || c.name.toLowerCase() === t);
}

/** A schedule entry as the model sees it: local date and times in the user's zone. */
function scheduleEntryForModel(e: ScheduleEntry, timeZone: string) {
  const hhmm = (d: Date) =>
    d.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return {
    id: e.id,
    what: e.notes,
    where: e.location || (e.projectAddress ? `${e.projectAddress} (project address)` : ""),
    date: dateInZone(e.startsAt, timeZone),
    startTime: hhmm(e.startsAt),
    endTime: hhmm(e.endsAt),
    project: e.projectTitle,
    projectId: e.projectId,
    assignedTo: e.assignedName,
    onMap: e.lat !== null,
  };
}

async function runTool(
  orgId: string,
  personId: string | null,
  name: string,
  args: Record<string, unknown>,
  currentAttachments: SavedAttachment[],
  context: AssistantContext,
): Promise<ToolResult> {
  try {
    return await runToolUnsafe(orgId, personId, name, args, currentAttachments, context);
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
  context: AssistantContext,
): Promise<ToolResult> {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  switch (name) {
    case "draft_estimate_from_photos": {
      const projectTitle = str(args.projectTitle);
      const projectId = await findProjectIdByTitle(orgId, projectTitle);
      if (!projectId) return { summary: `draft_estimate_from_photos failed: no project found named "${projectTitle}".` };
      const project = await getProject(projectId, orgId);
      const photos = await listProjectPhotos(projectId);
      if (!project || photos.length === 0) {
        return { summary: `draft_estimate_from_photos failed: "${projectTitle}" has no photos to work from yet.` };
      }
      const proposal = await analyzeProjectPhotos(
        orgId,
        { title: project.title, projectType: project.projectTypeName ?? "general", address: project.address, notes: project.notes },
        photos,
      );
      const id = await createEstimate({
        orgId,
        projectId,
        summary: proposal.summary,
        lineItems: proposal.lineItems,
        aiGenerated: true,
        createdBy: personId,
      });
      const total = proposal.lineItems.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
      return {
        summary: `Drafted an estimate for "${project.title}" from ${photos.length} photo(s): ${proposal.lineItems.length} line(s), $${total.toFixed(2)}.`,
        data: { id, total, lineItems: proposal.lineItems, link: `/projects/${projectId}` },
      };
    }
    case "create_estimate": {
      const projectTitle = str(args.projectTitle);
      const projectId = await findProjectIdByTitle(orgId, projectTitle);
      if (!projectId) return { summary: `create_estimate failed: no project found named "${projectTitle}".` };
      const kinds: LineItemKind[] = ["labor", "material", "other"];
      const lineItems = (Array.isArray(args.lineItems) ? args.lineItems : [])
        .map((raw) => {
          const l = (raw ?? {}) as Record<string, unknown>;
          return {
            description: str(l.description),
            quantity: Number(l.quantity ?? 1),
            unitPrice: Number(l.unitPrice ?? 0),
            kind: kinds.includes(l.kind as LineItemKind) ? (l.kind as LineItemKind) : "other",
          };
        })
        .filter((l) => l.description && Number.isFinite(l.quantity) && Number.isFinite(l.unitPrice) && l.quantity >= 0 && l.unitPrice >= 0);
      if (lineItems.length === 0) return { summary: "create_estimate failed: give at least one line item with a description, quantity and unit price." };
      const id = await createEstimate({
        orgId,
        projectId,
        summary: str(args.summary),
        lineItems,
        aiGenerated: true,
        createdBy: personId,
      });
      const total = lineItems.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
      return {
        summary: `Saved a draft estimate on "${projectTitle}": ${lineItems.length} line(s), $${total.toFixed(2)}.`,
        data: { id, total, link: `/projects/${projectId}` },
      };
    }
    case "list_invoices": {
      const projectTitle = str(args.projectTitle);
      const projectId = projectTitle ? await findProjectIdByTitle(orgId, projectTitle) : null;
      if (projectTitle && !projectId) return { summary: `list_invoices: no project found named "${projectTitle}".` };
      const date = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : null);
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 25));
      const rows = await query<{
        id: string;
        vendor: string;
        slug: string;
        category: string;
        invoice_date: string;
        due_date: string | null;
        amount: string;
        status: string;
        project_title: string | null;
        total: string;
        sum: string;
      }>(
        `SELECT i.id, v.name AS vendor, v.slug, i.category, i.invoice_date::text, i.due_date::text, i.amount::text,
                i.status, j.title AS project_title,
                count(*) OVER () AS total, sum(i.amount) OVER ()::text AS sum
           FROM invoices i JOIN vendors v ON v.id = i.vendor_id
           LEFT JOIN projects j ON j.id = i.project_id
          WHERE i.org_id = $1
            AND ($2 = '' OR v.name ILIKE '%' || $2 || '%' OR i.category ILIKE '%' || $2 || '%'
                 OR i.account_number ILIKE '%' || $2 || '%' OR i.amount::text LIKE $2 || '%')
            AND ($3::text IS NULL OR i.status = $3)
            AND ($4::uuid IS NULL OR i.project_id = $4)
            AND ($5::date IS NULL OR i.invoice_date >= $5)
            AND ($6::date IS NULL OR i.invoice_date <= $6)
          ORDER BY i.invoice_date DESC, i.created_at DESC
          LIMIT $7`,
        [orgId, str(args.search), str(args.status) || null, projectId, date(args.from), date(args.to), limit],
      );
      return {
        summary: `Found ${rows[0]?.total ?? 0} invoice(s)${rows.length ? `, totalling $${Number(rows[0].sum).toFixed(2)}` : ""}.`,
        data: {
          count: Number(rows[0]?.total ?? 0),
          total: Number(rows[0]?.sum ?? 0),
          invoices: rows.map((r) => ({
            id: r.id,
            vendor: r.vendor,
            category: r.category,
            date: r.invoice_date,
            dueDate: r.due_date,
            amount: Number(r.amount),
            status: r.status,
            project: r.project_title,
            link: `/invoices/${r.slug}?id=${r.id}`,
          })),
        },
      };
    }
    case "get_invoice": {
      const id = str(args.invoiceId);
      const row = /^[0-9a-f-]{36}$/i.test(id)
        ? await queryOne<{ slug: string }>(
            `SELECT v.slug FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = $1 AND i.org_id = $2`,
            [id, orgId],
          )
        : null;
      const detail = row ? await invoiceDetail(orgId, row.slug, id) : null;
      if (!detail) return { summary: `get_invoice: no invoice with id "${id}".` };
      const documents = await listInvoiceDocuments(id, orgId);
      return {
        summary: `${detail.vendor} — $${detail.amount.toFixed(2)} on ${detail.date} (${detail.status}).`,
        data: {
          ...detail,
          lineItems: detail.groups.flatMap((g) => g.lines),
          groups: undefined,
          documents: documents.map((d) => d.fileName),
          link: `/invoices/${detail.slug}?id=${detail.id}`,
          projectLink: detail.projectId ? `/projects/${detail.projectId}` : null,
        },
      };
    }
    case "link_invoice_to_project": {
      const id = str(args.invoiceId);
      const projectTitle = str(args.projectTitle);
      const projectId = projectTitle ? await findProjectIdByTitle(orgId, projectTitle) : null;
      if (projectTitle && !projectId) return { summary: `link_invoice_to_project failed: no project found named "${projectTitle}".` };
      if (!/^[0-9a-f-]{36}$/i.test(id)) return { summary: "link_invoice_to_project failed: invoiceId must be an id from list_invoices." };
      await setInvoiceProject(id, orgId, projectId);
      return {
        summary: projectId ? `Linked the invoice to "${projectTitle}".` : "Unlinked the invoice from its project.",
        data: { link: projectId ? `/projects/${projectId}` : null },
      };
    }
    case "search_email": {
      const query = str(args.query);
      if (!query) return { summary: "search_email failed: give a Gmail search." };
      const all = await listGmailConnectors(orgId);
      if (all.length === 0) return { summary: "search_email: no Gmail account is connected (Connectors page)." };
      const accountArg = str(args.account);
      // One mailbox at a time, chosen by the user — with several connected, ask before searching.
      if (!accountArg && all.length > 1) {
        return {
          summary:
            `search_email: not searched yet — ${all.length} mailboxes are connected: ${all.map(accountName).join(", ")}. ` +
            "Ask the user which one to search, then call again with that account.",
        };
      }
      const accounts = accountArg ? all.filter((c) => matchesAccount(c, accountArg)) : all;
      if (accounts.length === 0) {
        return { summary: `search_email: no connected mailbox matches "${accountArg}". Connected: ${all.map(accountName).join(", ")}.` };
      }
      const results = await Promise.all(
        accounts.map(async (c) => {
          const [{ count, capped }, sample] = await Promise.all([
            countMatches(orgId, c.id, query, BULK_TRASH_CAP),
            listMail({ orgId, connectorId: c.id, query, pageSize: 5 }),
          ]);
          return {
            mailbox: accountName(c),
            count,
            atLeast: capped,
            canTrash: hasGmailModifyScope(c),
            examples: sample.messages.map((m) => ({
              from: m.from || m.fromEmail,
              subject: m.subject,
              date: m.date ? dateInZone(m.date, context.timeZone) : null,
            })),
          };
        }),
      );
      const line = results.map((r) => `${r.mailbox}: ${r.atLeast ? "at least " : ""}${r.count.toLocaleString("en-US")}`).join("; ");
      return { summary: `Emails matching "${query}" — ${line}.`, data: { query, results } };
    }
    case "trash_email_search": {
      const query = str(args.query);
      const expected = Number(args.expectedCount);
      if (!query || !Number.isFinite(expected) || expected < 1) {
        return { summary: "trash_email_search failed: needs the query, the mailbox and the count the user confirmed." };
      }
      const all = await listGmailConnectors(orgId);
      const matches = all.filter((c) => matchesAccount(c, str(args.account)));
      if (matches.length !== 1) {
        return { summary: `trash_email_search failed: name exactly one mailbox — connected: ${all.map(accountName).join(", ")}.` };
      }
      const connector = matches[0];
      if (!hasGmailModifyScope(connector)) {
        return { summary: `trash_email_search failed: ${accountName(connector)} only has read access — reconnect it on the Connectors page to allow trashing.` };
      }
      // Recount right before trashing: if it moved beyond a small margin (mail arriving), the user confirms again.
      const { count, capped } = await countMatches(orgId, connector.id, query, BULK_TRASH_CAP);
      if (count === 0) return { summary: `Nothing matches "${query}" in ${accountName(connector)} any more — nothing trashed.` };
      if (Math.abs(count - expected) > Math.max(5, expected * 0.05)) {
        return {
          summary:
            `trash_email_search stopped: ${accountName(connector)} now has ${capped ? "at least " : ""}${count.toLocaleString("en-US")} ` +
            `matching emails, not the ${expected.toLocaleString("en-US")} the user confirmed. Tell them the new count and ask again. Nothing was trashed.`,
        };
      }
      if (!process.env.REDIS_URL) {
        return { summary: "trash_email_search failed: background jobs aren't set up on this server (no REDIS_URL), so bulk trash can't run." };
      }
      await enqueueTrashSearch(connector.id, query, personId ?? undefined);
      return {
        summary:
          `Started moving ${count.toLocaleString("en-US")} emails matching "${query}" in ${accountName(connector)} to Trash. ` +
          "Progress (with pause and cancel) is in the Updates panel; the user gets a notification when it's done." +
          (capped ? ` It stops after ${BULK_TRASH_CAP.toLocaleString("en-US")} — ask again for the rest.` : ""),
        data: { startedTrash: true, link: "/email" },
      };
    }
    case "find_place": {
      const place = await findPlace(str(args.query));
      if (!place) return { summary: `find_place: nothing found for "${str(args.query)}" — try adding a city or state.` };
      return { summary: `Found ${place.name}.`, data: { name: place.name, lat: place.lat, lng: place.lng } };
    }
    case "get_route": {
      const names = (Array.isArray(args.places) ? args.places : []).map(str).filter(Boolean).slice(0, 8);
      if (names.length < 2) return { summary: "get_route failed: give at least two places." };
      // One lookup a second (Nominatim's limit); repeated names reuse the first lookup.
      const found = new Map<string, Place | null>();
      for (const name of names) {
        if (found.has(name)) continue;
        if (found.size > 0) await geocodePause();
        found.set(name, await findPlace(name));
      }
      const missing = names.filter((n) => !found.get(n));
      if (missing.length) {
        return { summary: `get_route: couldn't find ${missing.map((m) => `"${m}"`).join(", ")} — try a fuller address.` };
      }
      const stops = names.map((n) => found.get(n)!);
      const route = await drivingRoute(stops);
      const straight = stops.slice(1).reduce((sum, s, i) => sum + milesBetween(stops[i], s), 0);
      const link = directionsUrl(stops);
      return {
        summary: route
          ? `Driving: ${route.miles} mi, about ${route.minutes} min (no live traffic).`
          : "No driving route found (or the route service is down) — straight-line distance only.",
        data: {
          stops: stops.map((s, i) => ({ asked: names[i], found: s.name })),
          driving: route,
          straightLineMiles: Math.round(straight * 10) / 10,
          directions: link,
        },
      };
    }
    case "list_schedule": {
      const today = dateInZone(new Date(), context.timeZone);
      const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(str(args.from)) ? str(args.from) : today;
      const from = zonedTimeToUtc(fromDay, "00:00", context.timeZone)!;
      const toDay = /^\d{4}-\d{2}-\d{2}$/.test(str(args.to)) ? str(args.to) : null;
      const to = toDay ? zonedTimeToUtc(toDay, "23:59", context.timeZone)! : new Date(from.getTime() + 30 * 86_400_000);
      const projectTitle = str(args.projectTitle);
      const projectId = projectTitle ? await findProjectIdByTitle(orgId, projectTitle) : null;
      if (projectTitle && !projectId) return { summary: `list_schedule: no project found named "${projectTitle}".` };
      const entries = await listSchedule(orgId, { from, to }, projectId ? { projectId } : {});
      return {
        summary: `${entries.length} schedule entr${entries.length === 1 ? "y" : "ies"} from ${fromDay}.`,
        data: { entries: entries.map((e) => scheduleEntryForModel(e, context.timeZone)) },
      };
    }
    case "update_schedule_entry": {
      const id = str(args.entryId);
      const current = /^[0-9a-f-]{36}$/i.test(id) ? await getScheduleEntry(id, orgId) : null;
      if (!current) return { summary: "update_schedule_entry failed: entryId must be an id from list_schedule." };
      const was = scheduleEntryForModel(current, context.timeZone);
      const given = (key: string) => typeof args[key] === "string";
      const changes: Parameters<typeof updateScheduleEntry>[2] = {};
      if (given("notes")) changes.notes = str(args.notes);
      if (given("location")) changes.location = str(args.location);
      if (given("date") || given("startTime") || given("endTime")) {
        const date = given("date") ? str(args.date) : was.date;
        const startsAt = zonedTimeToUtc(date, given("startTime") ? str(args.startTime) : was.startTime, context.timeZone);
        const endsAt = zonedTimeToUtc(date, given("endTime") ? str(args.endTime) : was.endTime, context.timeZone);
        if (!startsAt || !endsAt) return { summary: "update_schedule_entry failed: date must be YYYY-MM-DD and times HH:MM." };
        if (endsAt <= startsAt) return { summary: "update_schedule_entry failed: endTime must be after startTime." };
        changes.startsAt = startsAt;
        changes.endsAt = endsAt;
      }
      if (given("assigneeName")) {
        const name = str(args.assigneeName);
        if (!name) changes.assignedTo = null;
        else {
          const member = (await listTeam(orgId)).find((m) => m.name.toLowerCase() === name.toLowerCase());
          if (!member) return { summary: `update_schedule_entry failed: no team member named "${name}".` };
          changes.assignedTo = member.id;
        }
      }
      if (given("projectTitle")) {
        const title = str(args.projectTitle);
        const projectId = title ? await findProjectIdByTitle(orgId, title) : null;
        if (title && !projectId) return { summary: `update_schedule_entry failed: no project found named "${title}".` };
        changes.projectId = projectId;
      }
      await updateScheduleEntry(id, orgId, changes);
      const now = scheduleEntryForModel((await getScheduleEntry(id, orgId))!, context.timeZone);
      return {
        summary: `Updated the schedule entry "${now.what || now.project || id}".`,
        data: { entry: now, link: now.projectId ? `/projects/${now.projectId}` : "/schedule" },
      };
    }
    case "delete_schedule_entry": {
      const id = str(args.entryId);
      const current = /^[0-9a-f-]{36}$/i.test(id) ? await getScheduleEntry(id, orgId) : null;
      if (!current) return { summary: "delete_schedule_entry failed: entryId must be an id from list_schedule." };
      await deleteScheduleEntry(id, orgId);
      return { summary: `Removed the schedule entry "${current.notes || current.projectTitle || id}".` };
    }
    case "create_schedule_entry": {
      const projectTitle = str(args.projectTitle);
      const projectId = projectTitle ? await findProjectIdByTitle(orgId, projectTitle) : null;
      if (projectTitle && !projectId) return { summary: `create_schedule_entry failed: no project matches "${projectTitle}".` };
      if (!projectId && !str(args.notes)) return { summary: "create_schedule_entry failed: say what's happening (notes)." };
      const startsAt = zonedTimeToUtc(str(args.date), str(args.startTime), context.timeZone);
      const endsAt = zonedTimeToUtc(str(args.date), str(args.endTime), context.timeZone);
      if (!startsAt || !endsAt) return { summary: "create_schedule_entry failed: date must be YYYY-MM-DD and times HH:MM." };
      if (endsAt <= startsAt) return { summary: "create_schedule_entry failed: endTime must be after startTime." };
      let assignedTo: string | null = null;
      const assigneeName = str(args.assigneeName);
      if (assigneeName) {
        const member = (await listTeam(orgId)).find((m) => m.name.toLowerCase() === assigneeName.toLowerCase());
        if (!member) return { summary: `create_schedule_entry failed: no team member named "${assigneeName}".` };
        assignedTo = member.id;
      }
      const id = await createScheduleEntry({
        orgId,
        projectId,
        assignedTo,
        startsAt,
        endsAt,
        notes: str(args.notes),
        location: str(args.location),
      });
      return {
        summary: `Scheduled ${[str(args.notes), projectTitle].filter(Boolean).join(" — ")} on ${str(args.date)} ${str(args.startTime)}–${str(args.endTime)}.`,
        data: { id, link: "/schedule" },
      };
    }
    case "attach_email_files_to_project": {
      if (!context.email) return { summary: "attach_email_files_to_project failed: the user isn't viewing an email." };
      const projectTitle = str(args.projectTitle);
      const projectId = await findProjectIdByTitle(orgId, projectTitle);
      if (!projectId) return { summary: `attach_email_files_to_project failed: no project found named "${projectTitle}".` };
      const names = Array.isArray(args.attachmentNames)
        ? args.attachmentNames.filter((n): n is string => typeof n === "string")
        : [];
      const { photos, files, available } = await copyEmailAttachmentsToProject({
        orgId,
        connectorId: context.email.connectorId,
        messageId: context.email.id,
        projectId,
        uploadedBy: personId,
        names,
      });
      if (photos.length + files.length === 0) {
        return {
          summary: `attach_email_files_to_project: nothing to copy — the email's attachments are: ${available.join(", ") || "none"}.`,
        };
      }
      return {
        summary: `Copied ${photos.length} photo(s) and ${files.length} file(s) from the email to "${projectTitle}".`,
        data: { photos, files, link: `/projects/${projectId}` },
      };
    }
    case "record_email_invoice": {
      const email = context.email;
      if (!email) return { summary: "record_email_invoice failed: the user isn't viewing an email." };
      const docType = str(args.docType) === "receipt" ? "receipt" : "invoice";
      const projectTitle = str(args.projectTitle);
      const projectId = projectTitle ? await findProjectIdByTitle(orgId, projectTitle) : null;
      if (projectTitle && !projectId) return { summary: `record_email_invoice failed: no project matches "${projectTitle}".` };
      const recorded = await recordInvoiceFromEmail({
        orgId,
        message: email,
        docType,
        projectId,
        attachmentName: str(args.attachmentName) || undefined,
      });
      return {
        summary: recorded.alreadyRecorded
          ? `This ${docType} from ${recorded.vendorName} for $${recorded.total.toFixed(2)} on ${recorded.invoiceDate} is already recorded — nothing new was created.`
          : `Recorded a ${docType} from ${recorded.vendorName} for $${recorded.total.toFixed(2)} (read from ${recorded.source}).`,
        data: { ...recorded, link: `/invoices/${recorded.vendorSlug}?id=${recorded.invoiceId}` },
      };
    }
    case "draft_email_reply":
    case "send_email_reply": {
      const email = context.email;
      if (!email) return { summary: `${name} failed: the user isn't viewing an email.` };
      const body = str(args.body);
      if (!body) return { summary: `${name} failed: body is required.` };
      // Always back to the sender (or their Reply-To) — never an address taken from the email body.
      const to = email.replyTo || `${email.from} <${email.fromEmail}>`;
      const subject = /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`;
      const reply = replyContext(email);
      if (name === "draft_email_reply") {
        await createDraft({ orgId, connectorId: email.connectorId, to, subject, body, reply });
        return { summary: `Saved a reply to ${email.fromEmail} in Gmail Drafts.` };
      }
      await sendMail({ orgId, connectorId: email.connectorId, to, subject, body, reply });
      return { summary: `Sent a reply to ${email.fromEmail}.` };
    }
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
      const email = str(args.email).toLowerCase();
      // Reuse a customer already on file (same email, else same name) rather than duplicating them;
      // any contact details they're missing get filled in.
      const existing = email
        ? await queryOne<{ id: string; name: string }>(
            `SELECT id, name FROM customers WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
            [orgId, email],
          )
        : ((await listCustomers(orgId, name2)).find((c) => c.name.toLowerCase() === name2.toLowerCase()) ?? null);
      if (existing) {
        await query(
          `UPDATE customers SET email = coalesce(nullif(email, ''), $3), phone = coalesce(nullif(phone, ''), $4),
                  address = coalesce(nullif(address, ''), $5)
            WHERE id = $1 AND org_id = $2`,
          [existing.id, orgId, email || null, str(args.phone) || null, str(args.address) || null],
        );
        return {
          summary: `"${existing.name}" is already a customer — used the existing record.`,
          data: { id: existing.id, name: existing.name, link: `/customers/${existing.id}` },
        };
      }
      const id = await createCustomer({
        orgId,
        name: name2,
        email: email || null,
        phone: str(args.phone) || null,
        address: str(args.address) || null,
        notes: "",
      });
      return { summary: `Created customer "${name2}".`, data: { id, name: name2, link: `/customers/${id}` } };
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
      const customerId = await findOrCreateCustomer(orgId, customerName, {
        email: str(args.customerEmail),
        phone: str(args.customerPhone),
      });
      const projectTypeId = await findProjectTypeIdByName(orgId, str(args.projectTypeName) || undefined);
      const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(str(args.dueDate)) ? str(args.dueDate) : null;
      const id = await createProject({
        orgId,
        customerId,
        title,
        projectTypeId,
        address: str(args.address),
        notes: str(args.notes),
        dueDate,
        createdBy: personId,
      });
      return { summary: `Created project "${title}" for ${customerName}.`, data: { id, title, link: `/projects/${id}` } };
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
        notes: str(args.notes),
        dueDate: str(args.dueDate) || null,
        assignedTo: null,
        createdBy: personId,
        items: Array.isArray(args.items) ? args.items.filter((i): i is string => typeof i === "string") : [],
        timeZone: context.timeZone,
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
          await addProjectFile({
            projectId,
            folderId: null,
            fileName: a.fileName,
            contentType: a.contentType,
            bytes,
            uploadedBy: personId,
          });
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

const MAX_STEPS = 50;

function systemPrompt(
  pageContext: string | null,
  context: AssistantContext,
  sender: { name: string; email: string } | null = null,
  assistantName = "Hermes",
): string {
  return (
    `You are ${assistantName}, the assistant in a small business owner's operations app (Clandar). You can answer ` +
    "questions and take real actions — creating customers, projects, project types, tasks, and draft quotes, and " +
    "looking up or linking invoices/receipts (list_invoices, get_invoice) — using your " +
    "tools. Use a tool whenever the user asks you to look something up or create/change something; don't just " +
    "describe what you would do. A quote (estimate) always belongs to a project: if the job doesn't have a project " +
    "yet, call create_project first (include the customer's email when you know it, so the quote can be sent), then " +
    "draft the quote on it. Quotes are saved as drafts; the user reviews and sends them from the project page.\n\n" +
    "When the user attaches an image (a flyer, a service list, a job-site photo) or a document (its text is " +
    "included inline in their message, marked \"--- Attached: <filename> ---\"), read it and act on their " +
    "request with your tools — for example, extracting service categories from a flyer and calling " +
    "create_project_types. Once you have what you need, finish with a reply summarizing what you did or answering " +
    "the question. In replies, link to pages in the app with markdown links, e.g. " +
    '"[Project Types](/projects/types)" — the chat renders them as clickable links. Common pages: /projects, ' +
    "/projects/types, /projects/new, /customers, /schedule, /tasks, /settings." +
    "\n\nEmail search: when several mailboxes are connected, ask which one before searching — never search them all. " +
    "Email cleanup: to delete (trash) emails, first call search_email, then tell the user the mailbox, the " +
    "exact count and 2–3 example senders/subjects, and ask them to confirm. Only after they clearly say yes, call " +
    "trash_email_search with that mailbox, query and count. Never trash on your own initiative." +
    "\n\nSeveral team members can share this conversation: each user message starts with its sender's name in " +
    "brackets, e.g. \"[Joy Wang] …\". Keep track of who asked for what, and when someone says \"me\", \"my\" or " +
    "\"I\", it means that sender. Don't start your own replies with a bracketed name." +
    (sender ? `\n\nThe latest message is from ${sender.name} (${sender.email}).` : "") +
    (pageContext ? `\n\nThe user is currently viewing: ${pageContext}.` : "") +
    `\n\nToday is ${new Date().toLocaleDateString("en-CA", { timeZone: context.timeZone })} in the user's time zone (${context.timeZone}).` +
    (context.email
      ? "\n\nWhen asked to draft replies, write them out in your reply for the user to choose from; only call " +
        "draft_email_reply once they pick one (or ask you to save it), and send_email_reply only when they explicitly " +
        "say to send. When asked to create a project from this email, create it (finding or creating the customer from the " +
        "sender, passing their email as customerEmail), then call attach_email_files_to_project to copy the email's attachments onto it; if they also want a quote, " +
        "call draft_estimate_from_photos when the project has photos, or create_estimate with line items you work out " +
        "from the email. Quotes are only ever saved as drafts — tell the user to open the project to review and send it. " +
        "For a follow-up, use create_task with kind \"reminder\" and a dueDate. To confirm a schedule, " +
        "state the date/time and project you found and get the user's OK before calling create_schedule_entry. " +
        "Whenever the email is (or carries) an invoice, bill, statement or receipt, say so and list what you can see — " +
        "vendor, invoice/account number, date, due date, total — then ask whether to add it to their invoice records " +
        "(and to which project, if any); call record_email_invoice only after they say yes, then share the link it returns.\n\n" +
        emailContextBlock(context.email, context.emailAttachments)
      : "")
  );
}

function decodeDataUrl(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

/** Progress events streamed to the client as they happen (see app/api/assistant/route.ts): a tool finishing, a slice of the final reply arriving, or the whole turn wrapping up. */
export type AssistantEvent =
  | { type: "tool_call"; tool: string; detail: string }
  | { type: "started"; conversationId: string }
  | { type: "reply_delta"; text: string }
  | { type: "done"; conversationId: string }
  | { type: "error"; message: string; conversationId?: string };


export async function* askAssistant(
  orgId: string,
  personId: string | null,
  conversationId: string | null,
  question: string,
  extraContext: string,
  images: string[],
  attachments: IncomingAttachment[],
  pageContext: string | null,
  context: AssistantContext = { email: null, timeZone: "UTC" },
): AsyncGenerator<AssistantEvent> {
  const provider = await chatLlmProvider(orgId);
  if (!provider) {
    yield { type: "error", message: "No default LLM provider is configured — set one up on /settings first." };
    return;
  }

  const convId = conversationId ?? (await createConversation(orgId, personId));
  // Up front, so a turn stopped before it finishes still leaves the browser on the right conversation.
  yield { type: "started", conversationId: convId };

  const priorRows = await query<{ role: "user" | "assistant"; body: string; sender_name: string | null }>(
    `SELECT m.role, m.body, p.name AS sender_name
       FROM agent_messages m LEFT JOIN people p ON p.id = m.person_id
      WHERE m.conversation_id = $1 ORDER BY m.created_at`,
    [convId],
  );
  const sender = personId
    ? await queryOne<{ name: string; email: string }>(`SELECT name, email FROM people WHERE id = $1`, [personId])
    : null;
  // What the team calls its assistant (Settings → Chat).
  const assistantName =
    (await queryOne<{ assistant_name: string }>(`SELECT assistant_name FROM organizations WHERE id = $1`, [orgId]))
      ?.assistant_name ?? "Hermes";
  // Several team members can share a conversation, so each user message reaches the model
  // prefixed with its sender's name (the stored body stays as typed).
  const from = (name: string | null | undefined, text: string) => (name ? `[${name}] ${text}` : text);

  const userRow = await queryOne<{ id: string }>(
    `INSERT INTO agent_messages (conversation_id, role, body, person_id) VALUES ($1, 'user', $2, $3) RETURNING id`,
    [convId, question, personId],
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

  const questionForModel = from(sender?.name, extraContext ? `${question}\n\n${extraContext}` : question);
  // The email's image attachments ride along with this turn (system prompts can't carry images).
  const emailImages = context.emailAttachments?.images ?? [];
  const userContent: string | ChatContentPart[] =
    images.length > 0 || emailImages.length > 0
      ? [
          { type: "text", text: questionForModel },
          ...images.map((url): ChatContentPart => ({ type: "image_url", image_url: { url } })),
          ...(emailImages.length
            ? [
                {
                  type: "text",
                  text: `Images attached to the email being viewed (untrusted content from its sender): ${emailImages
                    .map((i) => i.name)
                    .join(", ")}`,
                } as ChatContentPart,
                ...emailImages.map((i): ChatContentPart => ({ type: "image_url", image_url: { url: i.dataUrl } })),
              ]
            : []),
        ]
      : questionForModel;

  const messages: ToolChatMessage[] = [
    { role: "system", content: systemPrompt(pageContext, context, sender, assistantName) },
    ...priorRows.map((r) => ({ role: r.role, content: r.role === "user" ? from(r.sender_name, r.body) : r.body }) as const),
    { role: "user", content: userContent },
  ];

  // Debug trace for this turn (agent_traces) — see recordTraceStep/finishTrace.
  const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…(+${text.length - max} chars)` : text);
  const trace = await queryOne<{ id: string }>(
    `INSERT INTO agent_traces (conversation_id, provider, model, page_context, system_prompt, user_input, image_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      convId,
      provider.name,
      provider.chatModel ?? provider.model ?? "",
      pageContext,
      clip(String(messages[0].content), 60_000),
      clip(questionForModel, 30_000),
      images.length + (context.emailAttachments?.images.length ?? 0),
    ],
  ).catch(() => null);
  const traceSteps: Record<string, unknown>[] = [];
  const saveTrace = async (end?: { reply?: string; error?: string }) => {
    if (!trace) return;
    await query(
      `UPDATE agent_traces SET steps = $2, final_reply = coalesce($3, final_reply), error = coalesce($4, error),
              finished_at = CASE WHEN $3::text IS NOT NULL OR $4::text IS NOT NULL THEN now() ELSE finished_at END
        WHERE id = $1`,
      [trace.id, JSON.stringify(traceSteps), end?.reply ?? null, end?.error ?? null],
    ).catch(() => {});
  };

  // Native tool calling: tools go in the request's `tools`, reply text streams straight through,
  // and each tool result goes back as a `tool` message.
  const tools = TOOLS.filter((t) => !t.emailOnly || context.email).map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
  const toolCalls: { tool: string; detail: string }[] = [];
  const replyParts: string[] = [];
  let finalReply: string;
  // Stop: what was written so far is kept, marked as stopped, and saved like any reply.
  const stopped = () => [...replyParts, "_Stopped._"].join("\n\n");
  try {
    let steps = 0;
    for (;;) {
      if (context.signal?.aborted) {
        finalReply = stopped();
        break;
      }
      const stepStarted = Date.now();
      let text = "";
      let calls: ModelToolCall[] = [];
      try {
        for await (const event of chatStreamWithTools(provider.id, messages, tools, {
          timeoutMs: 120_000,
          model: provider.chatModel ?? undefined,
          signal: context.signal,
        })) {
          if (event.type === "text") {
            text += event.text;
            yield { type: "reply_delta", text: event.text };
          } else if (event.type === "tool_calls") {
            calls = event.calls;
          }
        }
      } catch (error) {
        if (!context.signal?.aborted) throw error;
        if (text.trim()) replyParts.push(text.trim());
        finalReply = stopped();
        break;
      }
      const modelMs = Date.now() - stepStarted;
      if (text.trim()) replyParts.push(text.trim());

      if (calls.length === 0) {
        traceSteps.push({ step: traceSteps.length, modelMs, text: clip(text, 20_000), action: "reply" });
        finalReply = replyParts.join("\n\n") || "Done.";
        break;
      }
      steps += calls.length;
      if (steps > MAX_STEPS) {
        finalReply =
          toolCalls.length > 0
            ? `I did ${toolCalls.length} thing(s) before running out of steps: ${toolCalls
                .map((c) => c.detail)
                .join(" ")} Ask me to continue if there's more to do.`
            : "I ran into trouble finishing that — try rephrasing or breaking it into smaller steps.";
        break;
      }

      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
      });
      for (const call of calls) {
        // Stop between tools — one already running finishes, the rest don't start.
        if (context.signal?.aborted) break;
        const toolStarted = Date.now();
        let args: Record<string, unknown> = {};
        let result: ToolResult;
        try {
          args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
          result = await runTool(orgId, personId, call.name, args, savedAttachments, context);
        } catch {
          result = { summary: `${call.name} failed: its arguments weren't valid JSON.` };
        }
        traceSteps.push({
          step: traceSteps.length,
          modelMs,
          text: clip(text, 20_000),
          tool: call.name,
          args,
          toolMs: Date.now() - toolStarted,
          result: clip(JSON.stringify(result.data ?? result.summary), 8_000),
          summary: result.summary,
        });
        toolCalls.push({ tool: call.name, detail: result.summary });
        yield { type: "tool_call", tool: call.name, detail: result.summary };
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.data ?? result.summary) });
      }
      await saveTrace();
      // Keep any narration before the tool calls apart from what the model writes next.
      if (text.trim()) yield { type: "reply_delta", text: "\n\n" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The assistant could not answer that — try again.";
    await saveTrace({ error: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}`.slice(0, 8_000) : message });
    // Carries the conversation id, so even a failed first message leaves an id to copy for debugging.
    yield { type: "error", message, conversationId: convId };
    return;
  }
  await saveTrace({ reply: finalReply });

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
