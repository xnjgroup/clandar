/**
 * Reads a connected Gmail account — more than one can be connected at once, so
 * every function here takes the connector id of the one to read. Nothing is
 * stored: every call goes straight to the Gmail API with that connector's
 * access token, refreshed by `lib/connectors.ts` when it has expired.
 *
 * A connector made since the `gmail.modify` scope widening (see
 * `lib/connectors.ts`) can also have `trashMail` called for it; one made
 * before that only has `gmail.readonly` until it reconnects, and Gmail simply
 * rejects the trash call with a 403 until then. Payload parsing lives in
 * `lib/gmail-payload.ts`.
 */
import {
  getGmailConnector,
  listGmailConnectors,
  googleAccessToken,
  googleApiFailure,
  hasGmailModifyScope,
  type Connector,
} from "@/lib/connectors";
import {
  extractBody,
  header,
  summarize,
  type GmailMessage,
  type MailAttachment,
  type MailSummary,
} from "@/lib/gmail-payload";

export { fileSize } from "@/lib/gmail-payload";
export type { MailAttachment, MailSummary } from "@/lib/gmail-payload";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TIMEOUT_MS = 15_000;

export type MailboxView = {
  id: string;
  label: string;
  /** Gmail search syntax, as typed in Gmail's own search box. */
  query: string;
};

export const MAILBOX_VIEWS: MailboxView[] = [
  { id: "inbox", label: "Inbox", query: "in:inbox" },
  { id: "bills", label: "Bills & receipts", query: "invoice OR receipt OR statement OR bill" },
  { id: "unread", label: "Unread", query: "is:unread" },
  { id: "attachments", label: "With attachments", query: "has:attachment" },
  { id: "all", label: "All mail", query: "" },
];

/** The view /email opens on (and the one left out of the URL as `?view=`). */
export const DEFAULT_MAILBOX_VIEW = "inbox";

export function mailboxView(id: string): MailboxView {
  return MAILBOX_VIEWS.find((v) => v.id === (id || DEFAULT_MAILBOX_VIEW)) ?? MAILBOX_VIEWS[0];
}

export type MailDetail = MailSummary & {
  /** The connector actually used — the caller's choice, or the default. */
  connectorId: string;
  cc: string;
  html: string | null;
  text: string | null;
  attachments: MailAttachment[];
  /** RFC 822 headers a reply needs to thread correctly. */
  rfcMessageId: string;
  references: string;
  replyTo: string;
};

/** Raised when the account cannot be read, with a message fit for the screen. */
export class GmailError extends Error {
  readonly reconnect: boolean;
  constructor(message: string, reconnect = false) {
    super(message);
    this.name = "GmailError";
    this.reconnect = reconnect;
  }
}

/**
 * The connector to read, always scoped to `orgId`: `connectorId` if given (a
 * specific account, from the email screen's account switcher), otherwise the
 * org's first connected Gmail account. A `connectorId` belonging to a
 * different org is treated as not found — the multi-tenant guard against one
 * org reading another's mail by guessing or reusing a connector id.
 */
async function resolveConnector(orgId: string, connectorId?: string): Promise<Connector> {
  if (connectorId) {
    const connector = await getGmailConnector(connectorId);
    if (!connector || connector.orgId !== orgId) {
      throw new GmailError("That Gmail connector no longer exists", true);
    }
    return connector;
  }
  const [first] = await listGmailConnectors(orgId);
  if (!first) throw new GmailError("Gmail is not connected", true);
  return first;
}

const RATE_LIMIT_RETRIES = 6;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call<T>(
  connector: Connector,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<T> {
  let token: string;
  try {
    token = await googleAccessToken(connector.id);
  } catch (error) {
    throw new GmailError(error instanceof Error ? error.message : "No access token", true);
  }

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error: unknown) => {
      throw new GmailError(
        error instanceof Error && error.name === "TimeoutError"
          ? "Gmail did not respond in time"
          : "Could not reach the Gmail API",
      );
    });

    if (response.status === 404) throw new GmailError("That message no longer exists");

    // 429, and a 403 whose body says the same thing, mean "slow down" — never a
    // permissions problem, so it's never worth suggesting reconnect. Retried a
    // few times with backoff; if it's still happening after that, say so
    // plainly rather than exhausting into the generic 403-means-reconnect path
    // below, which would tell the user to reconnect for a problem reconnecting
    // can't fix.
    if (response.status === 429 || response.status === 403) {
      const message = await googleApiFailure(response, "The Gmail API");
      const rateLimited = response.status === 429 || /quota|rate limit/i.test(message);
      if (rateLimited) {
        if (attempt < RATE_LIMIT_RETRIES) {
          await sleep(2 ** attempt * 1000 + Math.random() * 500);
          continue;
        }
        throw new GmailError(`${message} Wait a minute and try again.`, false);
      }
      throw new GmailError(message, true); // a genuine permission/scope 403
    }

    if (!response.ok) {
      // 401 is worth another consent round; other failures are transient.
      throw new GmailError(await googleApiFailure(response, "The Gmail API"), response.status === 401);
    }
    return (await response.json()) as T;
  }
}

/** Runs `worker` over `items` a few at a time, keeping the input order. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ── Reads ────────────────────────────────────────────────── */

export type Mailbox = {
  /** The connector actually used — the caller's choice, or the default. */
  connectorId: string;
  account: string | null;
  messages: MailSummary[];
  nextPageToken: string | null;
  estimate: number;
};

/**
 * One page of the mailbox. Gmail's list call returns ids only, so each message's
 * headers are fetched alongside it — eight at a time.
 */
export async function listMail(options: {
  orgId: string;
  connectorId?: string;
  query: string;
  search?: string;
  pageToken?: string;
  pageSize?: number;
  /** Restrict to one Gmail label by id — exact for any label name, unlike search syntax. */
  labelId?: string;
}): Promise<Mailbox> {
  const connector = await resolveConnector(options.orgId, options.connectorId);

  const terms = [options.query, options.search?.trim()].filter(Boolean).join(" ");
  const params = new URLSearchParams({ maxResults: String(options.pageSize ?? 25) });
  if (terms) params.set("q", terms);
  if (options.labelId) {
    params.set("labelIds", options.labelId);
    // Gmail leaves spam and trash out of every listing unless asked.
    if (options.labelId === "SPAM" || options.labelId === "TRASH") params.set("includeSpamTrash", "true");
  }
  if (options.pageToken) params.set("pageToken", options.pageToken);

  const list = await call<{
    messages?: { id: string; threadId: string }[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>(connector, `/messages?${params}`);

  const ids = list.messages ?? [];
  const messages = await mapLimit(ids, 8, async (item) => {
    const detail = await call<GmailMessage>(
      connector,
      `/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
    );
    return summarize(detail);
  });

  return {
    connectorId: connector.id,
    account: connector.accountLabel,
    messages,
    nextPageToken: list.nextPageToken ?? null,
    estimate: list.resultSizeEstimate ?? messages.length,
  };
}

export async function readMail(id: string, orgId: string, connectorId?: string): Promise<MailDetail> {
  const connector = await resolveConnector(orgId, connectorId);
  const message = await call<GmailMessage>(connector, `/messages/${id}?format=full`);
  const { html, text, attachments } = extractBody(message.payload);

  return {
    ...summarize(message),
    connectorId: connector.id,
    cc: header(message, "Cc"),
    html,
    text,
    attachments,
    rfcMessageId: header(message, "Message-ID") || header(message, "Message-Id"),
    references: header(message, "References"),
    replyTo: header(message, "Reply-To"),
  };
}

/** The bytes of one attachment, for the download route. */
export async function readAttachment(
  messageId: string,
  attachmentId: string,
  orgId: string,
  connectorId?: string,
) {
  const connector = await resolveConnector(orgId, connectorId);
  const attachment = await call<{ size?: number; data?: string }>(
    connector,
    `/messages/${messageId}/attachments/${attachmentId}`,
  );
  if (!attachment.data) throw new GmailError("That attachment is empty");
  return Buffer.from(attachment.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** The whole original message as RFC 822 bytes — what a mail app saves as an `.eml` file. */
export async function readRawMail(messageId: string, orgId: string, connectorId?: string): Promise<Buffer> {
  const connector = await resolveConnector(orgId, connectorId);
  const message = await call<{ raw?: string }>(connector, `/messages/${messageId}?format=raw`);
  if (!message.raw) throw new GmailError("Gmail returned an empty message");
  return Buffer.from(message.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/* ── Cleanup worker ───────────────────────────────────────── */

export type ScannedMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: Date | null;
  labels: string[];
  sizeEstimate: number;
};

/**
 * Pages fully through `query`'s results — up to Gmail's 500-per-page maximum
 * each call — yielding one page of message metadata at a time. Built for a
 * worker scanning an entire inbox in the background, not a UI page; stops
 * once `maxMessages` total have been yielded or the query runs out.
 */
export async function* scanMail(
  connectorId: string,
  orgId: string,
  query: string,
  maxMessages: number,
): AsyncGenerator<ScannedMessage[]> {
  const connector = await resolveConnector(orgId, connectorId);
  let pageToken: string | undefined;
  let seen = 0;

  while (seen < maxMessages) {
    const params = new URLSearchParams({ maxResults: String(Math.min(100, maxMessages - seen)) });
    if (query) params.set("q", query);
    if (pageToken) params.set("pageToken", pageToken);

    const list = await call<{
      messages?: { id: string; threadId: string }[];
      nextPageToken?: string;
    }>(connector, `/messages?${params}`);

    const ids = list.messages ?? [];
    if (ids.length === 0) return;

    // Lower concurrency than the interactive mailbox view (lib/listMail): this
    // loop can run over thousands of messages in one call, and bursting that
    // many concurrent requests is what runs into Gmail's per-minute quota —
    // `call`'s own retry/backoff is the fallback if it happens anyway. Tuned
    // down further after that still wasn't enough headroom in practice.
    const items = await mapLimit(ids, 3, async (item) => {
      const detail = await call<GmailMessage>(
        connector,
        `/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      return {
        id: detail.id,
        threadId: detail.threadId,
        from: header(detail, "From"),
        subject: header(detail, "Subject") || "(no subject)",
        snippet: detail.snippet ?? "",
        date: detail.internalDate ? new Date(Number(detail.internalDate)) : null,
        labels: detail.labelIds ?? [],
        sizeEstimate: detail.sizeEstimate ?? 0,
      };
    });

    seen += items.length;
    yield items;

    pageToken = list.nextPageToken;
    if (!pageToken) return;
    await sleep(600); // a pause between pages, same reasoning as the concurrency cap above
  }
}

/**
 * Moves a message to Trash — reversible for 30 days, and never a permanent
 * delete. Requires the `gmail.modify` scope; a connector still on the older
 * `gmail.readonly` grant gets a 403 here until it reconnects.
 */
export async function trashMail(messageId: string, orgId: string, connectorId?: string): Promise<void> {
  const connector = await resolveConnector(orgId, connectorId);
  await call(connector, `/messages/${messageId}/trash`, "POST");
}

/** UTF-8 safe RFC 2047 header encoding, for a subject that might not be plain ASCII. */
function encodeHeaderWord(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Sends a plain-text email from the connected account — used by the quoting
 * flow to send an estimate, and by the customer-support draft/reply tools.
 * Requires the `gmail.modify` scope (covers `messages.send`, same as
 * `trashMail`); a connector still on the older read-only grant gets a 403
 * here until it reconnects.
 */
export type OutgoingAttachment = { fileName: string; contentType: string; bytes: Buffer };

/** The org's first enabled Gmail connector that's allowed to send, or null — for mail the app sends on its own (invites, reminders). */
export async function sendableGmailConnectorId(orgId: string): Promise<string | null> {
  for (const c of await listGmailConnectors(orgId)) {
    if (hasGmailModifyScope(c) && (await getGmailConnector(c.id))) return c.id;
  }
  return null;
}

/** What a reply needs to land in the original's thread. */
export type ReplyContext = { threadId: string; inReplyTo: string; references: string };

/** Threading for a reply to `message`: its thread, and References = its References + its Message-ID. */
export function replyContext(message: MailDetail): ReplyContext {
  return {
    threadId: message.threadId,
    inReplyTo: message.rfcMessageId,
    references: [message.references, message.rfcMessageId].filter(Boolean).join(" ").trim(),
  };
}

/** Base64 wrapped at 76 characters, as MIME requires for encoded bodies. */
function mimeBase64(bytes: Buffer): string {
  return bytes.toString("base64").replace(/.{76}/g, "$&\r\n");
}

/** A filename safe inside a quoted MIME parameter, with the real (possibly non-ASCII) name RFC 2047-encoded. */
function mimeFileName(name: string): string {
  const clean = name.replace(/[\r\n"\\]/g, "_");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : encodeHeaderWord(clean);
}

/** The full RFC 822 message: text (+ optional HTML alternative), then any attachments. */
function buildMime(input: {
  from: string;
  to: string;
  subject: string;
  inReplyTo?: string;
  references?: string;
  body: string;
  html?: string;
  attachments: OutgoingAttachment[];
}): string {
  const boundary = (tag: string) => `----clandar-${tag}-${crypto.randomUUID()}`;
  const part = (contentType: string, content: string) =>
    [`Content-Type: ${contentType}; charset="UTF-8"`, `Content-Transfer-Encoding: base64`, ``, mimeBase64(Buffer.from(content, "utf8"))].join(
      "\r\n",
    );

  let bodyPart: string;
  if (input.html) {
    const alt = boundary("alt");
    bodyPart = [
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      ``,
      `--${alt}`,
      part("text/plain", input.body),
      `--${alt}`,
      part("text/html", input.html),
      `--${alt}--`,
    ].join("\r\n");
  } else {
    bodyPart = part("text/plain", input.body);
  }

  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeaderWord(input.subject)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references ? [`References: ${input.references}`] : []),
    `MIME-Version: 1.0`,
  ];
  if (input.attachments.length === 0) return [...headers, bodyPart].join("\r\n");

  const mixed = boundary("mixed");
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    ``,
    `--${mixed}`,
    bodyPart,
    ...input.attachments.flatMap((a) => [
      `--${mixed}`,
      [
        `Content-Type: ${a.contentType || "application/octet-stream"}; name="${mimeFileName(a.fileName)}"`,
        `Content-Disposition: attachment; filename="${mimeFileName(a.fileName)}"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        mimeBase64(a.bytes),
      ].join("\r\n"),
    ]),
    `--${mixed}--`,
  ].join("\r\n");
}

/**
 * Sends one email from the org's Gmail connector — used by the project page's
 * flow to send an estimate, and by the customer-support draft/reply tools.
 * Requires the `gmail.modify` scope (covers `messages.send`, same as
 * `trashMail`); a connector still on the older read-only grant gets a 403
 * here until it reconnects.
 *
 * `html` adds a rich alternative to the plain-text `body`. With attachments
 * the message goes through Gmail's media-upload endpoint (up to 35MB) rather
 * than the JSON `raw` field, which is only meant for small messages.
 */
export async function sendMail(input: {
  orgId: string;
  connectorId?: string;
  to: string;
  subject: string;
  body: string;
  html?: string;
  attachments?: OutgoingAttachment[];
  /** Reply threading: Gmail thread id plus the RFC headers so every mail app groups it. */
  reply?: ReplyContext;
}): Promise<void> {
  const connector = await resolveConnector(input.orgId, input.connectorId);
  if (!hasGmailModifyScope(connector)) {
    throw new GmailError(
      `${connector.name} was connected before sending was needed and only has read access — reconnect it on /connectors to send from this account.`,
      true,
    );
  }

  const mime = buildMime({
    from: connector.accountLabel ?? "",
    to: input.to,
    subject: input.subject,
    body: input.body,
    html: input.html,
    attachments: input.attachments ?? [],
    inReplyTo: input.reply?.inReplyTo,
    references: input.reply?.references,
  });

  if (!input.attachments?.length) {
    await call(connector, `/messages/send`, "POST", {
      raw: toBase64Url(mime),
      ...(input.reply?.threadId ? { threadId: input.reply.threadId } : {}),
    });
    return;
  }

  let token: string;
  try {
    token = await googleAccessToken(connector.id);
  } catch (error) {
    throw new GmailError(error instanceof Error ? error.message : "No access token", true);
  }
  const response = await fetch(`${API.replace("/gmail/v1/", "/upload/gmail/v1/")}/messages/send?uploadType=media`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "message/rfc822" },
    body: mime,
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  }).catch((error: unknown) => {
    throw new GmailError(
      error instanceof Error && error.name === "TimeoutError" ? "Gmail did not respond in time" : "Could not reach the Gmail API",
    );
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const message = (() => {
      try {
        return (JSON.parse(detail) as { error?: { message?: string } }).error?.message;
      } catch {
        return undefined;
      }
    })();
    throw new GmailError(message ?? `Gmail rejected the message (${response.status})`, response.status === 401 || response.status === 403);
  }
}

/**
 * Saves a message to the account's Gmail Drafts (threaded as a reply when
 * `reply` is given) instead of sending — for a person to finish in Gmail.
 * Same `gmail.modify` scope as sending.
 */
export async function createDraft(input: {
  orgId: string;
  connectorId?: string;
  to: string;
  subject: string;
  body: string;
  reply?: ReplyContext;
}): Promise<void> {
  const connector = await resolveConnector(input.orgId, input.connectorId);
  if (!hasGmailModifyScope(connector)) {
    throw new GmailError(`${connector.name} only has read access — reconnect it on /connectors to save drafts.`, true);
  }
  const mime = buildMime({
    from: connector.accountLabel ?? "",
    to: input.to,
    subject: input.subject,
    body: input.body,
    attachments: [],
    inReplyTo: input.reply?.inReplyTo,
    references: input.reply?.references,
  });
  await call(connector, `/drafts`, "POST", {
    message: { raw: toBase64Url(mime), ...(input.reply?.threadId ? { threadId: input.reply.threadId } : {}) },
  });
}

/* ── Lead finder support (lib/lead-finder.ts) ─────────────── */

/** Ids of messages matching `query`, newest first, up to `max` — no per-message fetch. */
export async function listMessageIds(
  orgId: string,
  connectorId: string,
  query: string,
  max = 50,
): Promise<string[]> {
  const connector = await resolveConnector(orgId, connectorId);
  const params = new URLSearchParams({ q: query, maxResults: String(Math.min(max, 500)) });
  const list = await call<{ messages?: { id: string }[] }>(connector, `/messages?${params}`);
  return (list.messages ?? []).map((m) => m.id);
}

/**
 * The id of the Gmail label with this exact name (e.g. "Leads/Deck & fence"),
 * creating it if needed — Gmail shows "/" as nesting. Needs `gmail.modify`.
 */
export async function ensureGmailLabel(orgId: string, connectorId: string, name: string): Promise<string> {
  const connector = await resolveConnector(orgId, connectorId);
  const { labels = [] } = await call<{ labels?: { id: string; name: string }[] }>(connector, `/labels`);
  const found = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  // Parents first, so "Leads/Tile" nests under an existing/created "Leads".
  const parts = name.split("/");
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join("/");
    if (!labels.some((l) => l.name.toLowerCase() === parent.toLowerCase())) {
      await call(connector, `/labels`, "POST", { name: parent, labelListVisibility: "labelShow", messageListVisibility: "show" }).catch(
        () => {},
      );
    }
  }
  const created = await call<{ id: string }>(connector, `/labels`, "POST", {
    name,
    labelListVisibility: "labelShow",
    messageListVisibility: "show",
  });
  return created.id;
}

/** Adds and/or removes labels on one message. Needs `gmail.modify`. */
export async function modifyMessageLabels(
  orgId: string,
  connectorId: string,
  messageId: string,
  change: { add?: string[]; remove?: string[] },
): Promise<void> {
  const connector = await resolveConnector(orgId, connectorId);
  await call(connector, `/messages/${messageId}/modify`, "POST", {
    addLabelIds: change.add ?? [],
    removeLabelIds: change.remove ?? [],
  });
}

/* ── Label dashboard ──────────────────────────────────────── */

export type LabelCount = { id: string; label: string; total: number; unread: number };

/**
 * The system labels worth a dashboard tile — mirrors Gmail's own sidebar.
 * `labels.list` doesn't return counts (only `labels.get` per label does), so
 * this fetches each of these individually, in parallel; a small fixed list
 * rather than every custom label a person might have, which could be many.
 */
const DASHBOARD_LABELS: { id: string; label: string; query: string }[] = [
  { id: "INBOX", label: "Inbox", query: "in:inbox" },
  { id: "UNREAD", label: "Unread", query: "is:unread" },
  { id: "STARRED", label: "Starred", query: "is:starred" },
  { id: "CATEGORY_PROMOTIONS", label: "Promotions", query: "category:promotions" },
  { id: "CATEGORY_SOCIAL", label: "Social", query: "category:social" },
  { id: "CATEGORY_UPDATES", label: "Updates", query: "category:updates" },
  { id: "CATEGORY_FORUMS", label: "Forums", query: "category:forums" },
  { id: "SPAM", label: "Spam", query: "in:spam" },
  { id: "TRASH", label: "Trash", query: "in:trash" },
];

/** The canonical Gmail search query for a system label id — shared by the label dashboard, the cleanup scan's label picker, and bulk-trash. */
export const LABEL_QUERIES: Record<string, string> = Object.fromEntries(
  DASHBOARD_LABELS.map((l) => [l.id, l.query]),
);

async function fetchLabelCount(
  connector: Connector,
  id: string,
  label: string,
): Promise<LabelCount> {
  try {
    const detail = await call<{ messagesTotal?: number; messagesUnread?: number }>(
      connector,
      `/labels/${id}`,
    );
    return { id, label, total: detail.messagesTotal ?? 0, unread: detail.messagesUnread ?? 0 };
  } catch {
    // A label a account has never used (e.g. no Forums mail ever) still
    // exists as a system label and should read as zero, not an error.
    return { id, label, total: 0, unread: 0 };
  }
}

export async function labelCounts(orgId: string, connectorId?: string): Promise<LabelCount[]> {
  const connector = await resolveConnector(orgId, connectorId);
  return mapLimit(DASHBOARD_LABELS, 6, ({ id, label }) => fetchLabelCount(connector, id, label));
}

/** The labels the person created in Gmail (not system ones), by name — for the email page's side column. */
export async function listUserLabels(orgId: string, connectorId?: string): Promise<{ id: string; name: string }[]> {
  const connector = await resolveConnector(orgId, connectorId);
  const { labels = [] } = await call<{ labels?: { id: string; name: string; type?: string }[] }>(connector, `/labels`);
  return labels
    .filter((l) => l.type === "user")
    .map((l) => ({ id: l.id, name: l.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One label's count — a bulk-trash confirmation dialog and progress bar's denominator, without fetching all nine dashboard labels. */
export async function labelCount(labelId: string, orgId: string, connectorId?: string): Promise<number> {
  const connector = await resolveConnector(orgId, connectorId);
  return (await fetchLabelCount(connector, labelId, labelId)).total;
}
