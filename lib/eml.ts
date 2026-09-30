/**
 * Reads a saved email (.eml / RFC 822) for viewing in the app — the original
 * email kept as an invoice's source document. Parsing is postal-mime's; this
 * shapes it for the page: header fields, the HTML (with inline `cid:` images
 * swapped for data: URLs so they show in the sandboxed frame) or text body,
 * and the attachments, addressable by index for the download route.
 */
import PostalMime from "postal-mime";

/** Inline images bigger than this stay as attachments rather than being embedded in the page. */
const MAX_INLINE_IMAGE = 3 * 1024 * 1024;

type Address = { name?: string; address?: string; group?: unknown };

function formatAddress(a: Address | undefined): string {
  if (!a) return "";
  if (a.name && a.address) return `${a.name} <${a.address}>`;
  return a.address || a.name || "";
}

export type EmlAttachment = { index: number; filename: string; mimeType: string; size: number; inline: boolean };

export type ParsedEml = {
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: Date | null;
  html: string | null;
  text: string | null;
  attachments: EmlAttachment[];
};

function bytesOf(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

export async function parseEml(raw: Buffer): Promise<ParsedEml> {
  const email = await PostalMime.parse(raw);
  let html = email.html ?? null;
  const attachments: EmlAttachment[] = [];

  email.attachments.forEach((a, index) => {
    const bytes = bytesOf(a.content);
    const cid = a.contentId?.replace(/^<|>$/g, "");
    const embedded =
      Boolean(html && cid) && a.mimeType.startsWith("image/") && bytes.byteLength <= MAX_INLINE_IMAGE;
    if (embedded && html && cid) {
      const dataUrl = `data:${a.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
      html = html.split(`cid:${cid}`).join(dataUrl);
    }
    attachments.push({
      index,
      filename: a.filename || `attachment-${index + 1}`,
      mimeType: a.mimeType,
      size: bytes.byteLength,
      // Pictures shown within the body don't need listing as files unless the sender attached them too.
      inline: embedded && a.disposition !== "attachment",
    });
  });

  const date = email.date ? new Date(email.date) : null;
  return {
    from: formatAddress(email.from as Address | undefined),
    to: (email.to ?? []).map((a) => formatAddress(a as Address)).join(", "),
    cc: (email.cc ?? []).map((a) => formatAddress(a as Address)).join(", "),
    subject: email.subject ?? "(no subject)",
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    html,
    text: email.text ?? null,
    attachments,
  };
}

/** One attachment's bytes and type, by its index in the parsed email — for the download route. */
export async function emlAttachment(
  raw: Buffer,
  index: number,
): Promise<{ filename: string; mimeType: string; bytes: Uint8Array } | null> {
  const email = await PostalMime.parse(raw);
  const a = email.attachments[index];
  if (!a) return null;
  return { filename: a.filename || `attachment-${index + 1}`, mimeType: a.mimeType, bytes: bytesOf(a.content) };
}
