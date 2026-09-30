"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { createParser } from "eventsource-parser";
import { usePathname, useSearchParams } from "next/navigation";
import { ChatMarkdown } from "@/components/chat-markdown";
import { AssistantUpdates } from "@/components/assistant-updates";
import { Icon } from "@/components/icons";
import { JOBS_CHANGED_EVENT, type Notifications } from "@/components/use-notifications";
import type { AgentAttachment, AgentTurn, ConversationSummary } from "@/lib/assistant";

/**
 * Renders `[label](/path)` markdown links as real clickable links — the
 * assistant is told to reference pages this way (see lib/assistant.ts's
 * system prompt). Only relative, in-app paths are linkified; anything else
 * (a full URL, javascript:, ...) is left as plain text, since this text
 * comes from the model and shouldn't become an arbitrary clickable link.
 */
function renderMessageBody(text: string, onNavigate: () => void): ReactNode[] {
  const pattern = /\[([^\]]+)\]\((\/[^\s)]*)\)/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <Link key={key++} href={match[2]} onClick={onNavigate} className="font-medium underline">
        {match[1]}
      </Link>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

type Attachment = { name: string; mimeType: string; dataUrl: string };

// `previewUrl` is set only for the optimistic turn rendered immediately after
// sending — a local data: URL, since the real /api/assistant/attachments/{id}
// URL doesn't exist until the server has persisted the attachment.
type DisplayTurn = Omit<AgentTurn, "attachments"> & {
  attachments: (AgentAttachment & { previewUrl?: string })[];
};

const DOCUMENT_ACCEPT =
  ".md,.markdown,.txt,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx," +
  "application/pdf," +
  "application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-excel," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.ms-powerpoint," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  "text/markdown,text/plain," +
  "image/*";

/**
 * A real, org-scoped chat with the assistant (lib/assistant.ts; named in Settings → Chat) — docked on the
 * right and pushing page content left when open (see components/app-shell.tsx,
 * which owns `open` and renders this as a flex sibling of `<main>`). Knows
 * what page the user is on (`pageContext`) and can carry multiple switchable
 * conversations, so it replaces the old single-conversation /messages route.
 */
/** One-tap asks offered while viewing an email — each is just a prompt about "this email". */
const EMAIL_QUICK_ACTIONS: { label: string; prompt: string }[] = [
  {
    label: "Read & summarize",
    prompt:
      "Summarize this email: the gist, what they're asking for, any dates or amounts, and what I need to do. If it's an invoice, bill or receipt, show the parsed details and ask if I want it added to my invoice records.",
  },
  {
    label: "Draft replies",
    prompt:
      "Suggest 3 short, different replies to this email (for example: yes / need more info / polite no), labelled. Don't save or send anything yet — I'll pick one.",
  },
  {
    label: "Follow up",
    prompt:
      "Create a reminder task to follow up on this email in 3 days (unless the email implies a better date), with a note of what to follow up on.",
  },
  {
    label: "Confirm schedule",
    prompt:
      "Find the date/time being proposed or asked about in this email. Tell me what you found and which project it belongs to, and ask me to confirm before adding it to the schedule and saving a confirmation reply as a Gmail draft.",
  },
];

export function AssistantWidget({
  open,
  onOpenChange,
  tab,
  onTabChange,
  notifications,
  name,
  pageContext,
}: {
  /** What the team calls its assistant (Settings → Chat), "Hermes" by default. */
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chat, or Updates — the notifications, posted by the assistant. */
  tab: "chat" | "updates";
  onTabChange: (tab: "chat" | "updates") => void;
  notifications: Notifications;
  pageContext: string;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<DisplayTurn[] | null>(null);
  /** Who's viewing — messages from anyone else in a shared conversation get their name shown. */
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);

  // On a message page (/email/<gmail id>), the chat is about that email: the server reads it
  // and hands it to the model, and quick actions below offer the common asks.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const emailMatch = pathname.match(/^\/email\/([A-Za-z0-9]+)$/);
  const emailRef = emailMatch ? { id: emailMatch[1], account: searchParams.get("account") ?? undefined } : null;

  // Click-outside and Escape both close the switcher, same as any other popover.
  useEffect(() => {
    if (!switcherOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) setSwitcherOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSwitcherOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [switcherOpen]);

  // A conversation to open, handed over with the open event (`detail.conversationId`) — see below.
  const requestedConversation = useRef<string | null>(null);
  const [conversationRequest, setConversationRequest] = useState(0);

  // The most recent conversation loads by default the first time the panel opens.
  useEffect(() => {
    if (!open || turns !== null) return;
    fetch("/api/assistant")
      .then((r) => r.json())
      .then((data: { conversations: ConversationSummary[]; viewerId?: string }) => {
        if (data.viewerId) setViewerId(data.viewerId);
        setConversations(data.conversations);
        // A specific conversation was asked for (e.g. "Open in chat" on a briefing) — that one, not the latest.
        const requested = requestedConversation.current;
        requestedConversation.current = null;
        if (requested) loadConversation(requested);
        else if (data.conversations.length > 0) loadConversation(data.conversations[0].id);
        else setTurns([]);
      })
      .catch(() => setTurns([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, pending]);

  function loadConversation(id: string) {
    setSwitcherOpen(false);
    setTurns(null);
    setConversationId(id);
    fetch(`/api/assistant?conversationId=${id}`)
      .then((r) => r.json())
      .then((data: { conversation?: { turns: DisplayTurn[] }; viewerId?: string }) => {
        if (data.viewerId) setViewerId(data.viewerId);
        setTurns(data.conversation?.turns ?? []);
      })
      .catch(() => setTurns([]));
  }

  // A question handed over by an "Ask the assistant" button elsewhere (OpenAssistantButton's `prompt`):
  // asked in a fresh conversation as soon as the panel is open and its history has loaded.
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ prompt?: string; conversationId?: string }>).detail;
      if (detail?.prompt) setQueuedPrompt(detail.prompt);
      if (detail?.conversationId) {
        requestedConversation.current = detail.conversationId;
        setConversationRequest((n) => n + 1);
      }
    };
    window.addEventListener("clandar:open-assistant", onOpen);
    return () => window.removeEventListener("clandar:open-assistant", onOpen);
  }, []);
  // Panel already showing a conversation: switch to the requested one. (If it's still loading its
  // first one, the initial load above picks the request up instead.)
  useEffect(() => {
    if (!open || turns === null || !requestedConversation.current) return;
    const id = requestedConversation.current;
    requestedConversation.current = null;
    queueMicrotask(() => loadConversation(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationRequest]);

  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!open || !queuedPrompt || turns === null || pending) return;
    const prompt = queuedPrompt;
    queueMicrotask(() => {
      setQueuedPrompt(null);
      setSwitcherOpen(false);
      setConversationId(null);
      void sendRef.current(prompt, { fresh: true });
    });
  }, [open, queuedPrompt, turns, pending]);

  function startNewConversation() {
    onTabChange("chat");
    setSwitcherOpen(false);
    setConversationId(null);
    setTurns([]);
    setError(null);
  }

  // Clicking a link in a reply navigates the app underneath — on a narrow
  // screen the panel is a full-screen overlay, so close it or the
  // destination page would be hidden; on desktop it's docked beside the
  // page, so leave it open and let the user keep chatting while they look.
  function closeOnMobileNavigate() {
    if (window.matchMedia("(max-width: 1023px)").matches) onOpenChange(false);
  }

  async function refreshConversations(archived: boolean) {
    const res = await fetch(`/api/assistant${archived ? "?archived=true" : ""}`);
    const data = (await res.json()) as { conversations: ConversationSummary[] };
    setConversations(data.conversations);
  }

  async function openSwitcher() {
    setSwitcherOpen(true);
    setShowArchived(false);
    await refreshConversations(false);
  }

  async function toggleShowArchived() {
    const next = !showArchived;
    setShowArchived(next);
    await refreshConversations(next);
  }

  async function archiveConversation(id: string, archived: boolean) {
    await fetch("/api/assistant", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: id, archived }),
    });
    if (id === conversationId && archived) {
      // The active conversation just got hidden — drop back to a fresh one, but leave the switcher open.
      setConversationId(null);
      setTurns([]);
    }
    await refreshConversations(showArchived);
  }

  function onFilesChosen(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          { name: file.name, mimeType: file.type || "application/octet-stream", dataUrl: String(reader.result) },
        ]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function send(text?: string, options: { fresh?: boolean } = {}) {
    const q = (text ?? question).trim();
    if (!q || pending) return;
    setPending(true);
    setError(null);
    setQuestion("");
    const sentAttachments = attachments;
    setAttachments([]);

    // Optimistic: show the sent message (with local thumbnails) right away,
    // plus an empty streaming placeholder for the reply — then swap both for
    // the server's authoritative version (real ids, so attachments reload
    // correctly later) once the stream reports the saved conversation.
    setTurns((prev) => [
      ...(options.fresh ? [] : (prev ?? [])),
      {
        id: "pending",
        role: "user",
        body: q,
        senderId: viewerId,
        senderName: null,
        toolCalls: [],
        attachments: sentAttachments.map((a, i) => ({
          id: `pending-${i}`,
          fileName: a.name,
          contentType: a.mimeType,
          previewUrl: a.dataUrl,
        })),
      },
      { id: "streaming", role: "assistant", body: "", senderId: null, senderName: null, toolCalls: [], attachments: [] },
    ]);

    function updateStreamingTurn(patch: (t: DisplayTurn) => DisplayTurn) {
      setTurns((prev) => (prev ?? []).map((t) => (t.id === "streaming" ? patch(t) : t)));
    }

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: options.fresh ? null : conversationId,
          question: q,
          attachments: sentAttachments,
          pageContext,
          email: emailRef,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not send that — try again.");
        setTurns((prev) => prev?.filter((t) => t.id !== "pending" && t.id !== "streaming") ?? prev);
        return;
      }

      // The reply streams back as Server-Sent Events (see app/api/assistant/route.ts), parsed with
      // eventsource-parser; fetch rather than EventSource because this is a POST with a body.
      type StreamEvent =
        | { type: "tool_call"; tool: string; detail: string }
        | { type: "reply_delta"; text: string }
        | { type: "done"; conversationId: string }
        | { type: "error"; message: string; conversationId?: string }
        | { type: "conversation"; conversation: { id: string; turns: DisplayTurn[] } | null };
      // A bulk email trash started during this turn: its progress card shows in Updates right away,
      // and the panel switches there once the reply is done.
      let startedTrash = false;
      const handle = (event: StreamEvent) => {
        if (event.type === "tool_call") {
          if (event.tool === "trash_email_search" && event.detail.startsWith("Started")) {
            startedTrash = true;
            window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
          }
          updateStreamingTurn((t) => ({ ...t, toolCalls: [...t.toolCalls, { tool: event.tool, detail: event.detail }] }));
        } else if (event.type === "reply_delta") {
          updateStreamingTurn((t) => ({ ...t, body: t.body + event.text }));
        } else if (event.type === "error") {
          setError(event.message);
          // Keep the id even when the turn failed, so it can be copied for debugging.
          if (event.conversationId) setConversationId(event.conversationId);
        } else if (event.type === "conversation" && event.conversation) {
          setConversationId(event.conversation.id);
          setTurns(event.conversation.turns);
        }
      };
      const parser = createParser({
        onEvent: (message) => {
          try {
            handle(JSON.parse(message.data) as StreamEvent);
          } catch {
            // A malformed frame shouldn't end the stream.
          }
        },
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      if (startedTrash) onTabChange("updates");
    } catch {
      setError(`Could not reach ${name} — try again.`);
      setTurns((prev) => prev?.filter((t) => t.id !== "pending" && t.id !== "streaming") ?? prev);
    } finally {
      setPending(false);
    }
  }

  // Desktop: floats bottom-right (the app shell pads pages so content scrolls clear of it).
  // Phones: hidden — the bottom tab bar's last tab opens the chat instead.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label={`Open ${name}`}
        title={`Open ${name}`}
        className="fixed right-6 bottom-6 z-40 hidden size-[52px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-ink text-lime shadow-[0_6px_20px_rgba(16,18,17,0.28)] lg:flex"
      >
        <Icon name="bot" size={22} />
        {notifications.unread > 0 ? (
          <span
            aria-label={`${notifications.unread} new update${notifications.unread === 1 ? "" : "s"}`}
            className="absolute -top-[3px] -right-[3px] flex h-[19px] min-w-[19px] items-center justify-center rounded-full border-2 border-surface bg-bad-fg px-[4px] text-[10px] font-bold text-white"
          >
            {notifications.unread > 99 ? "99+" : notifications.unread}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex h-full flex-col border-line bg-surface lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-[400px] lg:shrink-0 lg:border-l">
      <div className="relative flex shrink-0 items-center gap-[9px] border-b border-line-soft bg-bg px-[16px] py-[13px]">
        {tab === "updates" ? (
          <button
            type="button"
            onClick={() => onTabChange("chat")}
            aria-label="Back to chat"
            title="Back to chat"
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-line bg-surface text-body-soft hover:text-ink"
          >
            <Icon name="chevL" size={16} />
          </button>
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-lime">
            <Icon name="bot" size={16} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{tab === "updates" ? "Updates" : name}</span>
        <button
          type="button"
          onClick={() => onTabChange(tab === "updates" ? "chat" : "updates")}
          aria-label={
            notifications.unread
              ? `Updates, ${notifications.unread} new`
              : tab === "updates"
                ? "Back to chat"
                : "Updates"
          }
          aria-pressed={tab === "updates"}
          title="Updates"
          className={`relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[9px] ${
            tab === "updates" ? "bg-ink text-lime" : "text-faint hover:text-body"
          }`}
        >
          <Icon name="bellSm" size={15} />
          {notifications.jobs.length > 0 && notifications.unread === 0 ? (
            // Something's running (e.g. an email trash) — its progress is in Updates.
            <span className="absolute -top-[2px] -right-[2px] size-[8px] animate-pulse rounded-full bg-meter-ok" />
          ) : null}
          {notifications.unread > 0 ? (
            <span className="absolute -top-[4px] -right-[4px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-bad-fg px-[3px] text-[9px] font-bold text-white">
              {notifications.unread > 99 ? "99+" : notifications.unread}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={startNewConversation}
          aria-label="New conversation"
          title="New conversation"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[9px] text-faint hover:text-body"
        >
          <Icon name="doc" size={15} />
        </button>
        {conversationId ? (
          // Copies this conversation's id — give it to a developer to look up its trace (agent_traces).
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(conversationId).then(() => {
                setCopiedId(true);
                setTimeout(() => setCopiedId(false), 1500);
              });
            }}
            aria-label="Copy conversation ID"
            title={copiedId ? "Copied!" : `Copy conversation ID (${conversationId.slice(0, 8)}…)`}
            className={`flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[9px] hover:text-body ${
              copiedId ? "text-ok-fg" : "text-faint"
            }`}
          >
            <Icon name={copiedId ? "check2" : "link2"} size={15} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={openSwitcher}
          aria-label="Switch conversation"
          title="Switch conversation"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[9px] text-faint hover:text-body"
        >
          <Icon name="clock" size={15} />
        </button>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close chat"
          title="Close chat"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[9px] text-faint hover:text-body"
        >
          <Icon name="close" size={16} />
        </button>

        {switcherOpen ? (
          <div
            ref={switcherRef}
            className="absolute top-[calc(100%+6px)] right-[12px] left-[12px] z-10 max-h-[340px] overflow-y-auto rounded-[14px] border border-line bg-surface p-[6px] shadow-[0_10px_30px_rgba(16,18,17,0.2)]"
          >
            {!showArchived ? (
              <button
                type="button"
                onClick={startNewConversation}
                className="flex w-full cursor-pointer items-center gap-[8px] rounded-[10px] px-[10px] py-[9px] text-left text-[12.5px] font-medium hover:bg-bg"
              >
                <Icon name="doc" size={14} className="shrink-0 text-body-soft" />
                New conversation
              </button>
            ) : null}
            {conversations === null ? (
              <p className="m-0 px-[10px] py-[8px] text-[11.5px] text-faint">Loading…</p>
            ) : conversations.length === 0 ? (
              <p className="m-0 px-[10px] py-[8px] text-[11.5px] text-faint">
                {showArchived ? "No archived conversations." : "No conversations yet."}
              </p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={`flex w-full items-center gap-[6px] rounded-[10px] px-[10px] py-[8px] hover:bg-bg ${
                    c.id === conversationId ? "bg-bg" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onTabChange("chat");
                      loadConversation(c.id);
                    }}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-[2px] text-left"
                  >
                    <span className="w-full truncate text-[12.5px] font-medium">{c.title}</span>
                    {c.lastMessage ? (
                      <span className="w-full truncate text-[11px] text-faint">{c.lastMessage}</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => archiveConversation(c.id, !showArchived)}
                    className="shrink-0 cursor-pointer text-[11px] font-medium text-faint underline hover:text-body"
                  >
                    {showArchived ? "Unarchive" : "Archive"}
                  </button>
                </div>
              ))
            )}
            <button
              type="button"
              onClick={toggleShowArchived}
              className="mt-[4px] flex w-full cursor-pointer items-center gap-[8px] rounded-[10px] border-t border-line-soft px-[10px] pt-[9px] pb-[6px] text-left text-[11.5px] font-medium text-body-soft"
            >
              {showArchived ? "Back to conversations" : "Archived conversations"}
            </button>
          </div>
        ) : null}
      </div>

      {/* Updates (the bell in the header): notifications — due reminders, lead digests … — posted by the assistant. */}
      {tab === "updates" ? (
        <AssistantUpdates notifications={notifications} onNavigate={closeOnMobileNavigate} />
      ) : (
        <>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto px-[14px] py-[14px]">
        {turns === null ? (
          <p className="m-0 text-[12px] text-faint">Loading…</p>
        ) : turns.length === 0 ? (
          <p className="m-0 text-[12px] leading-[1.5] text-muted">
            {emailRef
              ? "I can read the email you're viewing — summarize it, draft replies, set a follow-up, or confirm a schedule. Use the buttons below or just ask."
              : `Ask about a vendor, category, budget, or fraud flag, or ask me to create customers, projects, project types, or tasks — I can act on your data, not just describe it. Currently viewing: ${pageContext}.`}
          </p>
        ) : (
          turns.map((turn) => {
            const turnAttachments = turn.attachments ?? [];
            return turn.role === "user" ? (
              <div key={turn.id} className="flex max-w-[85%] flex-col items-end gap-[6px] self-end">
                {turn.senderName && viewerId && turn.senderId !== viewerId ? (
                  <span className="px-[4px] text-[11px] font-medium text-muted">{turn.senderName}</span>
                ) : null}
                {turnAttachments.length > 0 ? (
                  <div className="flex flex-wrap justify-end gap-[6px]">
                    {turnAttachments.map((a) =>
                      a.contentType.startsWith("image/") ? (
                        <div key={a.id} className="size-[64px] shrink-0 overflow-hidden rounded-[9px] border border-line">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={a.previewUrl ?? `/api/assistant/attachments/${a.id}`}
                            alt={a.fileName}
                            className="size-full object-cover"
                          />
                        </div>
                      ) : (
                        <a
                          key={a.id}
                          href={a.previewUrl ? undefined : `/api/assistant/attachments/${a.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex max-w-[160px] shrink-0 items-center gap-[5px] rounded-[9px] border border-line bg-bg px-[8px] py-[6px]"
                        >
                          <Icon name="doc" size={13} className="shrink-0 text-body-soft" />
                          <span className="min-w-0 truncate text-[11px] text-body-soft">{a.fileName}</span>
                        </a>
                      ),
                    )}
                  </div>
                ) : null}
                {turn.body ? (
                  <p className="m-0 rounded-[16px] bg-ink px-[12px] py-[8px] text-[15px] leading-[1.5] sm:text-[12.5px] whitespace-pre-wrap text-bg">
                    {renderMessageBody(turn.body, closeOnMobileNavigate)}
                  </p>
                ) : null}
              </div>
            ) : (
              <div key={turn.id} className="flex max-w-[92%] flex-col gap-[6px] self-start">
                {turn.toolCalls.length > 0 ? (
                  <details className="rounded-[10px] border border-line-soft bg-bg px-[9px] py-[6px]" open={turn.id === "streaming"}>
                    <summary className="cursor-pointer text-[11px] font-medium text-body-soft">
                      {turn.toolCalls.length} action{turn.toolCalls.length === 1 ? "" : "s"}
                    </summary>
                    <div className="mt-[6px] flex flex-col gap-[5px]">
                      {turn.toolCalls.map((step, i) => (
                        <div key={i} className="flex items-center gap-[7px]">
                          <span className="shrink-0 rounded-[5px] bg-ok-bg px-[6px] py-[2px] font-mono text-[9.5px] text-ok-fg">
                            {step.tool}
                          </span>
                          <span className="min-w-0 text-[11px] text-body-soft">{step.detail}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
                {turn.body ? (
                  <div className="rounded-[16px] bg-bg px-[12px] py-[9px] text-[15px] leading-[1.55] sm:text-[12.5px] text-body">
                    <ChatMarkdown text={turn.body} onNavigate={closeOnMobileNavigate} />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
        {/* Busy dots for the whole turn, until the stream finishes: a "thinking" bubble before anything
            arrives, then smaller dots under the reply/actions while it keeps streaming. */}
        {pending ? (
          <div
            className={`flex items-center gap-[4px] self-start ${
              turns?.some((t) => t.id === "streaming" && (t.body || t.toolCalls.length > 0))
                ? "-mt-[4px] px-[4px]"
                : "rounded-[16px] bg-bg px-[14px] py-[10px]"
            }`}
            aria-label={`${name} is working`}
            role="status"
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-[6px] animate-bounce rounded-full bg-faint"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-[6px] border-t border-line-soft px-[12px] py-[11px]">
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-[6px]">
            {attachments.map((a, i) =>
              a.mimeType.startsWith("image/") ? (
                <div key={i} className="relative size-[44px] shrink-0 overflow-hidden rounded-[9px] border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.dataUrl} alt={a.name} className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label={`Remove ${a.name}`}
                    title={`Remove ${a.name}`}
                    className="absolute top-[1px] right-[1px] flex size-[15px] cursor-pointer items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <Icon name="close" size={9} />
                  </button>
                </div>
              ) : (
                <div
                  key={i}
                  className="flex max-w-[160px] shrink-0 items-center gap-[5px] rounded-[9px] border border-line bg-bg px-[8px] py-[6px]"
                >
                  <Icon name="doc" size={13} className="shrink-0 text-body-soft" />
                  <span className="min-w-0 truncate text-[11px] text-body-soft">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label={`Remove ${a.name}`}
                    title={`Remove ${a.name}`}
                    className="shrink-0 cursor-pointer text-faint hover:text-bad-fg"
                  >
                    <Icon name="close" size={11} />
                  </button>
                </div>
              ),
            )}
          </div>
        ) : null}
        {emailRef ? (
          <div className="flex flex-wrap gap-[6px]">
            {EMAIL_QUICK_ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                disabled={pending}
                onClick={() => send(a.prompt)}
                className="cursor-pointer rounded-full border border-line bg-bg px-[10px] py-[5px] text-[11px] font-medium text-body hover:bg-line-soft disabled:opacity-40"
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-[8px]">
          <input
            ref={fileInputRef}
            type="file"
            accept={DOCUMENT_ACCEPT}
            multiple
            hidden
            onChange={(e) => onFilesChosen(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
            title="Attach an image, PDF, Word, Excel, or PowerPoint file"
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line text-body-soft"
          >
            <Icon name="camera" size={16} />
          </button>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask anything, or attach a file…"
            className="min-w-0 flex-1 rounded-full border border-line bg-bg px-[13px] py-[8px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]"
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={pending || !question.trim()}
            className="shrink-0 cursor-pointer rounded-full bg-ink px-[14px] py-[9px] text-[11.5px] font-semibold text-lime enabled:cursor-pointer disabled:opacity-40"
          >
            Send
          </button>
        </div>
        {error ? <span className="text-[11px] text-bad-fg">{error}</span> : null}
      </div>
        </>
      )}
    </div>
  );
}
