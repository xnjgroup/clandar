import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { askAssistant, getConversation, listConversations, setConversationArchived } from "@/lib/assistant";
import { extractDocumentText } from "@/lib/document-extract";
import { loadEmailAttachments } from "@/lib/email-context";
import { readMail, type MailDetail } from "@/lib/gmail";

/**
 * The floating assistant panel's data, fetched client-side so it works from
 * any page without a dedicated /messages route:
 *   GET  ?conversationId=<id>     → that conversation's turns
 *   GET  ?archived=true           → archived conversations, for the switcher's "Archived" view
 *   GET  (no query)               → the non-archived conversation list, for the switcher
 *   POST  { conversationId?, question, attachments?, pageContext? } → asks (streamed back as Server-Sent Events)
 *     the assistant (creating a conversation first if conversationId is
 *     omitted) and streams back newline-delimited JSON events as they
 *     happen — {type:"tool_call"}, {type:"reply_delta"} (a slice of the
 *     reply's text, for a word-by-word chat), {type:"error"}, and a final
 *     {type:"conversation", conversation} with the authoritative saved
 *     turns. Image attachments go to the vision model as-is; everything else
 *     (markdown, PDF, Word, Excel, PowerPoint) is text-extracted server-side
 *     first (lib/document-extract.ts).
 *   PATCH { conversationId, archived } → archives/unarchives a conversation
 *     without deleting it.
 */
export async function GET(request: Request) {
  const { org, person } = await requireSession();
  const params = new URL(request.url).searchParams;
  const conversationId = params.get("conversationId");

  if (conversationId) {
    const conversation = await getConversation(conversationId, org.id);
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    // viewerId: the chat labels other people's messages with their name (conversations can be shared).
    return NextResponse.json({ conversation, viewerId: person.id });
  }

  const archived = params.get("archived") === "true";
  const conversations = await listConversations(org.id, { includeArchived: archived });
  return NextResponse.json({
    conversations: archived ? conversations.filter((c) => c.archived) : conversations,
    viewerId: person.id,
  });
}

export async function PATCH(request: Request) {
  const { org } = await requireSession();
  const body = (await request.json()) as { conversationId?: string; archived?: boolean };
  if (!body.conversationId || typeof body.archived !== "boolean") {
    return NextResponse.json({ error: "conversationId and archived are required." }, { status: 400 });
  }
  await setConversationArchived(body.conversationId, org.id, body.archived);
  return NextResponse.json({ ok: true });
}

type Attachment = { name: string; mimeType: string; dataUrl: string };

function decodeDataUrl(dataUrl: string): Buffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Buffer.from(base64, "base64");
}

// A turn can include slow tools (e.g. reading an emailed invoice with AI) on top of the chat itself.
export const maxDuration = 300;

export async function POST(request: Request) {
  const { org, person } = await requireSession();
  const body = (await request.json()) as {
    conversationId?: string;
    question?: string;
    attachments?: Attachment[];
    pageContext?: string;
    /** Set on an email page: the open message, read here server-side (never trusted from the client). */
    email?: { id?: string; account?: string } | null;
    timeZone?: string;
    /** From the iPhone app: its Apple Calendar — connected (with the next two weeks as text) or not. */
    deviceCalendar?: { status?: string; events?: string } | null;
  };
  const question = body.question?.trim();
  if (!question) return NextResponse.json({ error: "Type a question first." }, { status: 400 });

  const attachments = body.attachments ?? [];
  const images = attachments.filter((a) => a.mimeType.startsWith("image/")).map((a) => a.dataUrl);
  const documents = attachments.filter((a) => !a.mimeType.startsWith("image/"));

  let extraContext = "";
  if (documents.length > 0) {
    const extracted = await Promise.all(
      documents.map((doc) => extractDocumentText(doc.name, doc.mimeType, decodeDataUrl(doc.dataUrl))),
    );
    const blocks = extracted.map((doc) =>
      "text" in doc
        ? `--- Attached: ${doc.name} ---\n${doc.text}`
        : `--- Attached: ${doc.name} (could not read: ${doc.error}) ---`,
    );
    extraContext = blocks.join("\n\n");
  }

  // The email the user is viewing, fetched fresh through their own connector — if it can't be read,
  // the chat still works, just without it.
  let email: MailDetail | null = null;
  if (body.email?.id && /^[A-Za-z0-9]+$/.test(body.email.id)) {
    email = await readMail(body.email.id, org.id, body.email.account || undefined).catch(() => null);
  }
  const emailAttachments = email ? await loadEmailAttachments(email, org.id).catch(() => undefined) : undefined;
  const timeZone = typeof body.timeZone === "string" && body.timeZone.length < 64 ? body.timeZone : "UTC";

  const events = askAssistant(
    org.id,
    person.id,
    body.conversationId ?? null,
    question,
    extraContext,
    images,
    attachments,
    body.pageContext ?? null,
    // request.signal aborts when the browser drops the stream — the chat's Stop button.
    {
      email,
      emailAttachments,
      timeZone,
      signal: request.signal,
      deviceCalendar:
        body.deviceCalendar?.status === "on"
          ? { status: "on", events: String(body.deviceCalendar.events ?? "").slice(0, 12_000) }
          : body.deviceCalendar?.status === "off"
            ? { status: "off" }
            : undefined,
    },
  );

  // Server-Sent Events: `data: <json>` frames. text/event-stream is what proxies/CDNs (Vercel's
  // included) know not to buffer or compress, so reply text reaches the browser as it's generated.
  const encoder = new TextEncoder();
  // Shared by start() and cancel(): once the browser has gone (Stop), nothing more is written.
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const write = (data: unknown) => send(`data: ${JSON.stringify(data)}\n\n`);
      // A comment line every 15s keeps the connection alive while a slow tool runs.
      const heartbeat = setInterval(() => send(": ping\n\n"), 15_000);
      try {
        for await (const event of events) {
          write(event);
          if (event.type === "done") {
            const conversation = await getConversation(event.conversationId, org.id);
            write({ type: "conversation", conversation });
          }
        }
      } catch (error) {
        write({ type: "error", message: error instanceof Error ? error.message : "Something went wrong." });
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    // Stopped by the browser: stop writing (the turn itself winds down via request.signal and is still saved).
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
