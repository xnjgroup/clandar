/**
 * Discussion comment text — shared by the server (notifications) and the browser (rendering, the
 * composer). A comment is plain text where `<@person-uuid>` mentions a person, `<#kind:uuid>`
 * references one of the project's things (task, invoice, file, photo, estimate), and http(s) URLs
 * are links — video links get a preview card.
 */

export const MENTION = /<@([0-9a-f-]{36})>/gi;
export const REF = /<#(task|invoice|file|photo|estimate):([0-9a-f-]{36})>/gi;
const URL_PATTERN = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

export const REF_KINDS = ["task", "invoice", "file", "photo", "estimate"] as const;
export type RefKind = (typeof REF_KINDS)[number];

/** Something a comment can reference with #, as shown to the reader. */
export type Ref = { kind: RefKind; id: string; label: string; link: string | null };

export type CommentSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; personId: string }
  | { kind: "ref"; refKind: RefKind; id: string }
  | { kind: "link"; url: string };

/** Splits a comment into text, mentions, references and links, in order. */
export function commentSegments(body: string): CommentSegment[] {
  const tokens: { index: number; length: number; segment: CommentSegment }[] = [];
  for (const m of body.matchAll(MENTION)) {
    tokens.push({ index: m.index!, length: m[0].length, segment: { kind: "mention", personId: m[1].toLowerCase() } });
  }
  for (const m of body.matchAll(REF)) {
    tokens.push({ index: m.index!, length: m[0].length, segment: { kind: "ref", refKind: m[1].toLowerCase() as RefKind, id: m[2].toLowerCase() } });
  }
  for (const m of body.matchAll(URL_PATTERN)) {
    tokens.push({ index: m.index!, length: m[0].length, segment: { kind: "link", url: m[0] } });
  }
  tokens.sort((a, b) => a.index - b.index);

  const segments: CommentSegment[] = [];
  let at = 0;
  for (const t of tokens) {
    if (t.index < at) continue; // overlapping match
    if (t.index > at) segments.push({ kind: "text", text: body.slice(at, t.index) });
    segments.push(t.segment);
    at = t.index + t.length;
  }
  if (at < body.length) segments.push({ kind: "text", text: body.slice(at) });
  return segments;
}

/** The people a comment mentions (unique). */
export function mentionedIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((m) => m[1].toLowerCase()))];
}

/** The things a comment references (unique). */
export function referencedRefs(body: string): { kind: RefKind; id: string }[] {
  const seen = new Set<string>();
  const out: { kind: RefKind; id: string }[] = [];
  for (const m of body.matchAll(REF)) {
    const key = `${m[1].toLowerCase()}:${m[2].toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: m[1].toLowerCase() as RefKind, id: m[2].toLowerCase() });
  }
  return out;
}

/** The comment as plain text — "@Name" and "#Label" — for notifications and previews. */
export function commentPlainText(
  body: string,
  nameOf: (personId: string) => string | undefined,
  labelOf: (kind: RefKind, id: string) => string | undefined = () => undefined,
): string {
  return body
    .replace(MENTION, (_, id: string) => `@${nameOf(id.toLowerCase()) ?? "someone"}`)
    .replace(REF, (_, kind: string, id: string) => `#${labelOf(kind.toLowerCase() as RefKind, id.toLowerCase()) ?? kind.toLowerCase()}`);
}

export type VideoLink = { provider: "YouTube" | "Vimeo" | "Loom" | "Video"; thumbnail: string | null };

/** A link that's a video, with a thumbnail when the provider has a public one (YouTube). */
export function videoLink(url: string): VideoLink | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let youtubeId: string | null = null;
  if (host === "youtu.be") youtubeId = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    youtubeId = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1] ?? null;
  }
  if (youtubeId && /^[\w-]{6,20}$/.test(youtubeId)) {
    return { provider: "YouTube", thumbnail: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") return { provider: "Vimeo", thumbnail: null };
  if (host === "loom.com") return { provider: "Loom", thumbnail: null };
  if (/\.(mp4|mov|webm|m4v)$/i.test(u.pathname)) return { provider: "Video", thumbnail: null };
  return null;
}
