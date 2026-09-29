/**
 * Turning Gmail's `messages.get` payloads into the shapes the screens render.
 * Pure functions only — no network, no database — so the awkward parts
 * (base64url bodies, nested multiparts, `"Name" <addr>` headers) can be
 * exercised on their own.
 */

export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  /** Gmail's own approximate size in bytes, headers and attachments included. */
  sizeEstimate?: number;
  payload?: GmailPart;
};

export type MailSummary = {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  date: Date | null;
  snippet: string;
  unread: boolean;
  starred: boolean;
  labels: string[];
};

export type MailAttachment = {
  /** Gmail's handle for the bytes, used by the download route. */
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
};

/** Labels Gmail uses as flags rather than folders; shown differently or not at all. */
const FLAG_LABELS = ["UNREAD", "STARRED", "IMPORTANT"];

export function header(message: GmailMessage, name: string) {
  const match = message.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return match?.value ?? "";
}

/** `"Acme Billing <billing@acme.test>"` → display name and address. */
export function parseAddress(value: string) {
  const angled = /^(.*)<([^>]+)>\s*$/.exec(value.trim());
  if (angled) {
    const name = angled[1].trim().replace(/^"|"$/g, "");
    return { name: name || angled[2].trim(), email: angled[2].trim() };
  }
  const bare = value.trim();
  return { name: bare, email: bare };
}

export function decodeBody(data: string) {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function summarize(message: GmailMessage): MailSummary {
  const from = parseAddress(header(message, "From"));
  const raw = header(message, "Date");
  const date = message.internalDate
    ? new Date(Number(message.internalDate))
    : raw
      ? new Date(raw)
      : null;

  return {
    id: message.id,
    threadId: message.threadId,
    from: from.name,
    fromEmail: from.email,
    to: header(message, "To"),
    subject: header(message, "Subject") || "(no subject)",
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    snippet: message.snippet ?? "",
    unread: message.labelIds?.includes("UNREAD") ?? false,
    starred: message.labelIds?.includes("STARRED") ?? false,
    labels: (message.labelIds ?? []).filter((l) => !FLAG_LABELS.includes(l)),
  };
}

/**
 * Walks the MIME tree for the best body to show and every real attachment.
 * The first `text/html` and `text/plain` part win; inline parts with a filename
 * and an attachment id are attachments even when they are images.
 */
export function extractBody(payload: GmailPart | undefined) {
  let html: string | null = null;
  let text: string | null = null;
  const attachments: MailAttachment[] = [];

  const walk = (part: GmailPart | undefined) => {
    if (!part) return;
    const mime = part.mimeType ?? "";

    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: mime || "application/octet-stream",
        size: part.body.size ?? 0,
      });
    } else if (mime === "text/html" && part.body?.data && html === null) {
      html = decodeBody(part.body.data);
    } else if (mime === "text/plain" && part.body?.data && text === null) {
      text = decodeBody(part.body.data);
    }

    for (const child of part.parts ?? []) walk(child);
  };

  walk(payload);
  return { html: html as string | null, text: text as string | null, attachments };
}

/** "412 KB" — attachment sizes are always approximate in Gmail. */
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
