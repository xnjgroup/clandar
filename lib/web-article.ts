/**
 * Saving a web article to the Library: fetch the page (safely — see safeFetch), keep its readable
 * text (Mozilla Readability; WeChat articles read straight from their #js_content body), its title,
 * site, author and date, and an AI summary with key points and tags — then index it like any other
 * Library item (lib/library.ts). The original link is kept; the saved copy is for the workspace's own
 * reading and search.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { convert } from "html-to-text";
import { parseHTML } from "linkedom";
import sanitizeHtml from "sanitize-html";
import { query, queryOne } from "@/lib/db";
import { deleteUpload, saveUpload } from "@/lib/storage";
import { indexLibraryItem } from "@/lib/library";
import { chatComplete, chatLlmProvider } from "@/lib/llm-providers";

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** Whether an IP address is somewhere a server-side fetch must never go (this machine, a private network, cloud metadata). */
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a === "::1" || a === "::" || a.startsWith("fe80:") || a.startsWith("fc") || a.startsWith("fd")) return true;
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

/**
 * Fetches a public http(s) resource: every hop (redirects too) must resolve to a public address;
 * size- and time-capped, and the content type must be what the caller expects.
 */
async function safeFetch(
  rawUrl: string,
  options: { accept: string; expect: (type: string) => boolean; maxBytes: number; referer?: string },
): Promise<{ bytes: Buffer; type: string; finalUrl: string }> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop < 5; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) links can be saved.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new Error("That link points to a private address.");

    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        "user-agent": BROWSER_UA,
        accept: options.accept,
        "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8",
        ...(options.referer ? { referer: options.referer } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      url = new URL(response.headers.get("location")!, url);
      continue;
    }
    if (!response.ok) throw new Error(`The page answered ${response.status}.`);
    const type = response.headers.get("content-type") ?? "";
    if (!options.expect(type)) throw new Error(`That link isn't a web page (${type.split(";")[0] || "unknown type"}) — upload the file instead.`);
    if (Number(response.headers.get("content-length") ?? 0) > options.maxBytes) throw new Error("Too large to save.");
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > options.maxBytes) {
        await reader.cancel();
        throw new Error("Too large to save.");
      }
      chunks.push(value);
    }
    return { bytes: Buffer.concat(chunks), type, finalUrl: url.toString() };
  }
  throw new Error("Too many redirects.");
}

async function fetchPage(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
  const { bytes, type, finalUrl } = await safeFetch(rawUrl, {
    accept: "text/html,application/xhtml+xml",
    expect: (t) => t.includes("html"),
    maxBytes: MAX_BYTES,
  });
  const charset = /charset=([\w-]+)/i.exec(type)?.[1] ?? "utf-8";
  try {
    return { html: new TextDecoder(charset).decode(bytes), finalUrl };
  } catch {
    return { html: new TextDecoder("utf-8").decode(bytes), finalUrl };
  }
}

export type ReadArticle = {
  url: string;
  title: string;
  siteName: string | null;
  author: string | null;
  publishedAt: Date | null;
  text: string;
  /** The article's body as HTML (not yet cleaned), image sources made absolute. */
  html: string;
};

/** Reads a page into its article: title, site, author, date and the readable text. */
export async function readArticle(rawUrl: string): Promise<ReadArticle> {
  const { html, finalUrl } = await fetchPage(rawUrl);
  const { document } = parseHTML(html);
  const meta = (selector: string) => document.querySelector(selector)?.getAttribute("content")?.trim() || null;

  let title = meta('meta[property="og:title"]') ?? document.querySelector("title")?.textContent?.trim() ?? "";
  let siteName = meta('meta[property="og:site_name"]');
  let author = meta('meta[name="author"]') ?? meta('meta[property="article:author"]');
  let published: string | null = meta('meta[property="article:published_time"]') ?? meta('meta[name="date"]');
  let contentHtml: string | null = null;

  // WeChat (mp.weixin.qq.com): the body is #js_content (hidden until its script runs); the account
  // name and publish time are in inline script variables.
  const wechat = document.querySelector("#js_content");
  if (wechat && /(^|\.)weixin\.qq\.com$/.test(new URL(finalUrl).hostname)) {
    for (const img of wechat.querySelectorAll("img[data-src]")) img.setAttribute("src", img.getAttribute("data-src") ?? "");
    contentHtml = wechat.innerHTML;
    const nickname = /var nickname\s*=\s*htmlDecode\("([^"]*)"\)/.exec(html)?.[1] ?? /var nickname\s*=\s*"([^"]*)"/.exec(html)?.[1];
    if (nickname) siteName = nickname;
    const created = /var ct\s*=\s*"(\d{9,})"/.exec(html)?.[1];
    if (created) published = new Date(Number(created) * 1000).toISOString();
    author = author && author !== siteName ? author : null;
  } else {
    const article = new Readability(document as unknown as Document).parse();
    if (article?.content) {
      contentHtml = article.content;
      title = title || article.title || "";
      siteName = siteName ?? article.siteName ?? null;
      author = author ?? article.byline ?? null;
      published = published ?? article.publishedTime ?? null;
    }
  }
  if (!contentHtml) throw new Error("Couldn't find an article on that page.");
  // Image sources absolute (lazy-loading sites keep the real one in data-src).
  const { document: body } = parseHTML(`<div id="a">${contentHtml}</div>`);
  for (const img of body.querySelectorAll("img")) {
    const src = img.getAttribute("data-src") || img.getAttribute("src") || "";
    try {
      img.setAttribute("src", src ? new URL(src, finalUrl).toString() : "");
    } catch {
      img.setAttribute("src", "");
    }
  }
  contentHtml = body.querySelector("#a")?.innerHTML ?? contentHtml;

  const text = convert(contentHtml, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
    ],
  })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < 200) throw new Error("That page has too little text to save — it may need a sign-in or load its content with scripts.");
  const date = published ? new Date(published) : null;
  return {
    url: finalUrl,
    title: title || new URL(finalUrl).hostname,
    siteName: siteName || new URL(finalUrl).hostname.replace(/^www\./, ""),
    author,
    publishedAt: date && !Number.isNaN(date.getTime()) ? date : null,
    text,
    html: contentHtml,
  };
}

/** An AI summary of the article: a few sentences, key points and tags, in the article's language. */
async function summarize(orgId: string, article: ReadArticle): Promise<{ summary: string; keyPoints: string[]; tags: string[] } | null> {
  const provider = await chatLlmProvider(orgId);
  if (!provider) return null;
  const raw = await chatComplete(
    provider.id,
    [
      {
        role: "system",
        content:
          "You summarize an article for someone saving it to read later. Reply with JSON only: " +
          '{"summary": "3-5 sentences", "keyPoints": ["4-6 short points"], "tags": ["2-5 lowercase topic tags"]}. ' +
          "Write the summary and key points in the article's own language; tags in English. Don't invent facts.",
      },
      { role: "user", content: `Title: ${article.title}\nSource: ${article.siteName ?? ""}\n\n${article.text.slice(0, 24_000)}` },
    ],
    { model: provider.chatModel ?? undefined, timeoutMs: 90_000 },
  );
  try {
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { summary?: string; keyPoints?: string[]; tags?: string[] };
    return {
      summary: String(json.summary ?? "").trim(),
      keyPoints: (json.keyPoints ?? []).map(String).filter(Boolean).slice(0, 8),
      tags: (json.tags ?? []).map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 6),
    };
  } catch {
    return { summary: raw.trim().slice(0, 1500), keyPoints: [], tags: [] };
  }
}

export type SavedArticle = {
  id: string;
  title: string;
  url: string;
  siteName: string | null;
  author: string | null;
  publishedAt: Date | null;
  summary: string;
  keyPoints: string[];
  tags: string[];
  alreadySaved: boolean;
};

/**
 * Saves a link to the Library as an article (the same link again just refreshes it): reads it,
 * summarizes it, stores and indexes it.
 */
export async function saveArticle(orgId: string, personId: string | null, rawUrl: string, extraTags: string[] = []): Promise<SavedArticle> {
  const article = await readArticle(rawUrl);
  const ai = await summarize(orgId, article).catch(() => null);
  const keyPoints = ai?.keyPoints ?? [];
  const summaryText = [ai?.summary ?? "", ...keyPoints.map((p) => `• ${p}`)].filter(Boolean).join("\n");
  const tags = [...new Set([...extraTags.map((t) => t.toLowerCase()), ...(ai?.tags ?? [])])].slice(0, 8);

  const existing = await queryOne<{ id: string }>(`SELECT id FROM library_items WHERE org_id = $1 AND kind = 'article' AND url = $2`, [
    orgId,
    article.url,
  ]);
  const fields = [article.title, article.siteName, article.author, article.publishedAt, summaryText || null, tags, article.text];
  const row = existing
    ? await queryOne<{ id: string }>(
        `UPDATE library_items SET title = $2, site_name = $3, author = $4, published_at = $5, summary = $6, tags = $7,
                content = $8, status = 'pending', updated_at = now()
          WHERE id = $1 RETURNING id`,
        [existing.id, ...fields],
      )
    : await queryOne<{ id: string }>(
        `INSERT INTO library_items (org_id, kind, url, title, site_name, author, published_at, summary, tags, content, created_by)
         VALUES ($1, 'article', $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [orgId, article.url, ...fields, personId],
      );
  await storeFormattedCopy(row!.id, article);
  await indexLibraryItem(row!.id);
  return {
    id: row!.id,
    title: article.title,
    url: article.url,
    siteName: article.siteName,
    author: article.author,
    publishedAt: article.publishedAt,
    summary: ai?.summary ?? "",
    keyPoints,
    tags,
    alreadySaved: Boolean(existing),
  };
}

/**
 * A picture made reasonable to keep: no wider than 1600 px, WebP at quality 80 (looks the same on
 * screen, a fraction of the size). Animated GIFs and anything sharp can't read are kept as they are.
 */
async function shrinkImage(bytes: Buffer): Promise<{ bytes: Buffer; type: string } | null> {
  try {
    const { default: sharp } = await import("sharp");
    const image = sharp(bytes, { failOn: "none" });
    const meta = await image.metadata();
    if ((meta.pages ?? 1) > 1) return null;
    const out = await image.rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return out.length < bytes.length ? { bytes: out, type: "image/webp" } : null;
  } catch {
    return null;
  }
}

const MAX_IMAGES = 40;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

type StoredImage = { key: string; type: string; size: number };

/**
 * The article's formatted copy: its pictures downloaded into storage (this workspace's own copies, so
 * they last even if the original goes), and the HTML cleaned to plain formatting with each picture
 * pointing at its stored copy (/api/library/{id}/images/{n}). Pictures that can't be fetched are left out.
 */
async function storeFormattedCopy(itemId: string, article: ReadArticle): Promise<void> {
  const { document } = parseHTML(`<div id="a">${article.html}</div>`);
  const root = document.querySelector("#a")!;
  const imgs = [...root.querySelectorAll("img")].filter((img) => /^https?:/.test(img.getAttribute("src") ?? ""));

  // Download up to MAX_IMAGES, six at a time, in order.
  const stored: (StoredImage | null)[] = new Array(Math.min(imgs.length, MAX_IMAGES)).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < stored.length) {
        const index = next++;
        const src = imgs[index].getAttribute("src")!;
        try {
          const { bytes, type } = await safeFetch(src, {
            accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
            expect: (t) => t.startsWith("image/") && !t.includes("svg"),
            maxBytes: MAX_IMAGE_BYTES,
          });
          const small = await shrinkImage(bytes);
          const out = small ?? { bytes, type: type.split(";")[0] };
          const ext = out.type.split("/")[1]?.replace("jpeg", "jpg") || "img";
          stored[index] = { key: await saveUpload("library-images", itemId, `${index + 1}.${ext}`, out.bytes), type: out.type, size: out.bytes.length };
        } catch {
          stored[index] = null;
        }
      }
    }),
  );

  // Point each kept picture at its stored copy; drop the rest.
  const kept: StoredImage[] = [];
  imgs.forEach((img, index) => {
    const image = index < stored.length ? stored[index] : null;
    if (!image) return img.remove();
    img.setAttribute("src", `/api/library/${itemId}/images/${kept.length}`);
    img.setAttribute("loading", "lazy");
    kept.push(image);
  });
  for (const img of root.querySelectorAll("img")) if (!/^\/api\/library\//.test(img.getAttribute("src") ?? "")) img.remove();

  const clean = sanitizeHtml(root.innerHTML, {
    allowedTags: ["p", "br", "h1", "h2", "h3", "h4", "h5", "ul", "ol", "li", "blockquote", "strong", "b", "em", "i", "u", "s",
      "a", "img", "figure", "figcaption", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "hr", "section", "span", "div"],
    allowedAttributes: { a: ["href"], img: ["src", "alt", "loading"] },
    allowedSchemes: ["http", "https"],
    allowedSchemesByTag: { img: [] },
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" }) },
    exclusiveFilter: (frame) => frame.tag === "img" && !/^\/api\/library\/[0-9a-f-]+\/images\/\d+$/.test(frame.attribs.src ?? ""),
  });

  // Replace an earlier copy's pictures (saving the same link again).
  const old = await queryOne<{ images: StoredImage[] }>(`SELECT images FROM library_items WHERE id = $1`, [itemId]);
  await query(`UPDATE library_items SET content_html = $2, images = $3 WHERE id = $1`, [itemId, clean, JSON.stringify(kept)]);
  await Promise.all((old?.images ?? []).map((i) => deleteUpload(i.key).catch(() => {})));
}
