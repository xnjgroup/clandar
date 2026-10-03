/**
 * The Library: everything a workspace has filed, searchable — every project's files (mirrored into
 * library_items, and gone when the file is), documents uploaded to the Library itself, and (later)
 * saved web articles.
 *
 * Indexing reads an item's text (lib/document-extract.ts), keeps it whole on the item, and splits it
 * into passages of about a page (library_chunks). Search is full-text through PGroonga, which handles
 * Chinese/Japanese/Korean as well as English: passages are matched and ranked, the best passage per
 * item wins, a match in the title counts extra, and the hit comes back with a highlighted snippet
 * and its PDF page. (Meaning search with vectors can be added beside it later.)
 */
import { extractDocumentParts } from "@/lib/document-extract";
import { query, queryOne, transaction } from "@/lib/db";
import { deleteUpload, readUpload, saveUpload } from "@/lib/storage";

export type LibraryItemKind = "project_file" | "file" | "article";

export type LibraryItem = {
  id: string;
  kind: LibraryItemKind;
  title: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  url: string | null;
  summary: string | null;
  tags: string[];
  status: "pending" | "indexed" | "failed" | "skipped";
  statusDetail: string | null;
  createdAt: Date;
  /** Where it's filed: the project (for a project's file) or a Library folder. */
  projectId: string | null;
  projectTitle: string | null;
  folderId: string | null;
  /** The project file it mirrors — its download goes through the project's files API. */
  projectFileId: string | null;
};

export type LibraryHit = LibraryItem & {
  /** The best-matching passage, with matches wrapped in <mark>…</mark> (everything else escaped). */
  snippet: string;
  /** That whole passage as plain text (about a page) — what the assistant reads. */
  passage: string;
  page: number | null;
  score: number;
};

type ItemRow = {
  id: string;
  kind: LibraryItemKind;
  title: string;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  url: string | null;
  summary: string | null;
  tags: string[];
  status: LibraryItem["status"];
  status_detail: string | null;
  created_at: Date;
  project_id: string | null;
  project_title: string | null;
  folder_id: string | null;
  project_file_id: string | null;
};

const ITEM_COLUMNS = `i.id, i.kind, i.title, coalesce(i.file_name, f.file_name) AS file_name,
  coalesce(i.content_type, f.content_type) AS content_type, coalesce(i.size_bytes, f.size_bytes) AS size_bytes,
  i.url, i.summary, i.tags, i.status, i.status_detail, i.created_at, p.id AS project_id, p.title AS project_title,
  i.folder_id, i.project_file_id`;
const ITEM_FROM = `library_items i
  LEFT JOIN project_files f ON f.id = i.project_file_id
  LEFT JOIN projects p ON p.id = f.project_id`;

function toItem(r: ItemRow): LibraryItem {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    fileName: r.file_name,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    url: r.url,
    summary: r.summary,
    tags: r.tags,
    status: r.status,
    statusDetail: r.status_detail,
    createdAt: r.created_at,
    projectId: r.project_id,
    projectTitle: r.project_title,
    folderId: r.folder_id,
    projectFileId: r.project_file_id,
  };
}

/* ── Keeping the Library in step with project files ─────────── */

/** Adds a Library item for each of the org's project files that doesn't have one yet. */
export async function mirrorProjectFiles(orgId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `INSERT INTO library_items (org_id, kind, project_file_id, title, tags, created_by, created_at)
     SELECT p.org_id, 'project_file', f.id, regexp_replace(f.file_name, '\\.[^.]+$', ''), f.tags, f.uploaded_by, f.created_at
       FROM project_files f JOIN projects p ON p.id = f.project_id
      WHERE p.org_id = $1 AND NOT EXISTS (SELECT 1 FROM library_items i WHERE i.project_file_id = f.id)
     ON CONFLICT (project_file_id) DO NOTHING
     RETURNING id`,
    [orgId],
  );
  return rows.length;
}

/**
 * Brings the Library up to date: mirrors new project files, then indexes what's pending — at most
 * `limit` items (each is a file read + text extraction), oldest first. Returns how many it indexed.
 */
export async function syncLibrary(orgId: string, limit = 10): Promise<number> {
  await mirrorProjectFiles(orgId);
  const pending = await query<{ id: string }>(
    `SELECT id FROM library_items WHERE org_id = $1 AND status = 'pending' ORDER BY created_at LIMIT $2`,
    [orgId, limit],
  );
  for (const { id } of pending) await indexLibraryItem(id);
  return pending.length;
}

/** A project file was just added: mirror and index it (called after the upload's response). */
export async function indexProjectFile(projectFileId: string): Promise<void> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO library_items (org_id, kind, project_file_id, title, tags, created_by, created_at)
     SELECT p.org_id, 'project_file', f.id, regexp_replace(f.file_name, '\\.[^.]+$', ''), f.tags, f.uploaded_by, f.created_at
       FROM project_files f JOIN projects p ON p.id = f.project_id WHERE f.id = $1
     ON CONFLICT (project_file_id) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [projectFileId],
  );
  if (row) await indexLibraryItem(row.id);
}

/* ── Indexing ─────────────────────────────────────────────── */

const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 150;
/** Whole-document text kept on the item (and indexed) is capped — a huge export isn't a document. */
const MAX_CHARS = 2_000_000;

/** Passages of about CHUNK_CHARS, breaking at paragraph / sentence ends where it can, overlapping a little. */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= CHUNK_CHARS) return clean ? [clean] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start + CHUNK_CHARS * 0.6, end);
      // Prefer a paragraph break, then a sentence end (。！？ for CJK too), then a space.
      const breaks = [window.lastIndexOf("\n\n"), Math.max(...[". ", "。", "！", "？", "! ", "? "].map((p) => window.lastIndexOf(p))), window.lastIndexOf(" ")];
      const at = breaks.find((b) => b > 0);
      if (at !== undefined) end = start + Math.floor(CHUNK_CHARS * 0.6) + at + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks.filter(Boolean);
}

/** Reads an item's file and stores its text and passages. Never throws — a failure is recorded on the item. */
export async function indexLibraryItem(itemId: string): Promise<void> {
  const item = await queryOne<{
    org_id: string;
    kind: LibraryItemKind;
    title: string;
    file_path: string | null;
    file_name: string | null;
    content_type: string | null;
    content: string;
  }>(
    `SELECT i.org_id, i.kind, i.title, coalesce(i.file_path, f.file_path) AS file_path, coalesce(i.file_name, f.file_name) AS file_name,
            coalesce(i.content_type, f.content_type) AS content_type, i.content
       FROM library_items i LEFT JOIN project_files f ON f.id = i.project_file_id WHERE i.id = $1`,
    [itemId],
  );
  if (!item) return;
  const fail = (status: "failed" | "skipped", detail: string) =>
    query(`UPDATE library_items SET status = $2, status_detail = $3, indexed_at = now(), updated_at = now() WHERE id = $1`, [
      itemId,
      status,
      detail.slice(0, 500),
    ]);

  let parts: { page: number | null; text: string }[];
  if (item.kind === "article") {
    parts = [{ page: null, text: item.content }];
  } else {
    if (!item.file_path) return void (await fail("failed", "The file is missing."));
    let bytes: Buffer;
    try {
      bytes = await readUpload(item.file_path);
    } catch {
      return void (await fail("failed", "Couldn't read the stored file."));
    }
    const extracted = await extractDocumentParts(item.file_name ?? "file", item.content_type ?? "", bytes);
    if ("error" in extracted) return void (await fail("skipped", extracted.error));
    parts = extracted.parts;
  }

  // Passages per page, so a hit knows its page; the whole text is kept on the item too.
  const passages: { page: number | null; text: string }[] = [];
  let total = 0;
  for (const part of parts) {
    if (total >= MAX_CHARS) break;
    const text = part.text.slice(0, MAX_CHARS - total);
    total += text.length;
    for (const chunk of chunkText(text)) passages.push({ page: part.page, text: chunk });
  }
  // The title (and file name) lead the first passage, so it's searched by the same rules as the
  // text — a title match counts, and "-word" excludes the whole document.
  if (passages.length > 0) {
    const heading = [item.title, item.file_name && item.file_name !== item.title ? item.file_name : null].filter(Boolean).join(" · ");
    passages[0] = { ...passages[0], text: `${heading}\n${passages[0].text}` };
  }
  const content = parts.map((p) => p.text).join("\n\n").slice(0, MAX_CHARS);
  if (!content.trim()) return void (await fail("skipped", "No text found (a scanned page or an image?)."));

  await transaction(async (client) => {
    await client.query(`DELETE FROM library_chunks WHERE item_id = $1`, [itemId]);
    if (passages.length > 0) {
      await client.query(
        `INSERT INTO library_chunks (item_id, org_id, ordinal, page, content)
         SELECT $1, $2, n - 1, page, content FROM unnest($3::int[], $4::text[]) WITH ORDINALITY AS c(page, content, n)`,
        [itemId, item.org_id, passages.map((p) => p.page), passages.map((p) => p.text)],
      );
    }
    await client.query(
      `UPDATE library_items SET content = $2, status = 'indexed', status_detail = NULL, indexed_at = now(), updated_at = now() WHERE id = $1`,
      [itemId, item.kind === "article" ? item.content : content],
    );
  });
}

/* ── Documents uploaded to the Library itself ─────────────── */

export async function addLibraryFile(input: {
  orgId: string;
  folderId: string | null;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  createdBy: string | null;
  tags?: string[];
}): Promise<string> {
  const filePath = await saveUpload("library-files", input.orgId, input.fileName, input.bytes);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO library_items (org_id, kind, folder_id, title, file_path, file_name, content_type, size_bytes, tags, created_by)
     VALUES ($1, 'file', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      input.orgId,
      input.folderId,
      input.fileName.replace(/\.[^.]+$/, ""),
      filePath,
      input.fileName,
      input.contentType,
      input.bytes.byteLength,
      input.tags ?? [],
      input.createdBy,
    ],
  );
  return row!.id;
}

/** Removes a document uploaded to the Library (a project's file is removed from its project instead). */
export async function deleteLibraryItem(id: string, orgId: string): Promise<boolean> {
  const row = await queryOne<{ file_path: string | null; images: { key: string }[] }>(
    `DELETE FROM library_items WHERE id = $1 AND org_id = $2 AND kind <> 'project_file' RETURNING file_path, images`,
    [id, orgId],
  );
  if (!row) return false;
  const keys = [row.file_path, ...(row.images ?? []).map((i) => i.key)].filter((k): k is string => Boolean(k));
  await Promise.all(keys.map((k) => deleteUpload(k).catch(() => {})));
  return true;
}

export type LibraryItemDetail = LibraryItem & {
  content: string;
  /** A saved article's cleaned HTML, its pictures served from /api/library/{id}/images/{n}. */
  contentHtml: string | null;
  images: { key: string; type: string; size: number }[];
  filePath: string | null;
  siteName: string | null;
  author: string | null;
  publishedAt: Date | null;
};

export async function getLibraryItem(id: string, orgId: string): Promise<LibraryItemDetail | null> {
  const row = await queryOne<
    ItemRow & {
      content: string;
      content_html: string | null;
      images: LibraryItemDetail["images"];
      file_path: string | null;
      site_name: string | null;
      author: string | null;
      published_at: Date | null;
    }
  >(
    `SELECT ${ITEM_COLUMNS}, i.content, i.content_html, i.images, coalesce(i.file_path, f.file_path) AS file_path, i.site_name, i.author, i.published_at
       FROM ${ITEM_FROM} WHERE i.id = $1 AND i.org_id = $2`,
    [id, orgId],
  );
  return row
    ? {
        ...toItem(row),
        content: row.content,
        contentHtml: row.content_html,
        images: row.images ?? [],
        filePath: row.file_path,
        siteName: row.site_name,
        author: row.author,
        publishedAt: row.published_at,
      }
    : null;
}

/* ── Browsing and searching ───────────────────────────────── */

export type LibraryFilter = {
  kind?: LibraryItemKind;
  projectId?: string;
  folderId?: string;
  tag?: string;
};

function filterSql(filter: LibraryFilter, params: unknown[]): string {
  const where: string[] = [];
  if (filter.kind) where.push(`i.kind = $${params.push(filter.kind)}`);
  if (filter.projectId) where.push(`p.id = $${params.push(filter.projectId)}`);
  if (filter.folderId) where.push(`i.folder_id = $${params.push(filter.folderId)}`);
  if (filter.tag) where.push(`$${params.push(filter.tag.toLowerCase())} = ANY (i.tags)`);
  return where.length ? ` AND ${where.join(" AND ")}` : "";
}

/** The newest items first (the Library's default view). */
export async function listLibrary(orgId: string, filter: LibraryFilter = {}, limit = 50, offset = 0): Promise<LibraryItem[]> {
  const params: unknown[] = [orgId];
  const where = filterSql(filter, params);
  const rows = await query<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM ${ITEM_FROM} WHERE i.org_id = $1${where}
      ORDER BY i.created_at DESC LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
    params,
  );
  return rows.map(toItem);
}

/**
 * Full-text search: PGroonga's query syntax (words are ANDed; "quoted phrase", OR, -word). Each
 * item's best passage ranks it (the title leads its first passage). Returns the items with a snippet.
 */
export async function searchLibrary(orgId: string, text: string, filter: LibraryFilter = {}, limit = 20): Promise<LibraryHit[]> {
  const q = text.trim().slice(0, 300);
  if (!q) return [];
  const params: unknown[] = [orgId, q];
  const where = filterSql(filter, params);
  const rows = await query<ItemRow & { snippet: string[] | null; passage: string | null; page: number | null; score: number }>(
    `WITH passage_hits AS (
       SELECT c.item_id, c.page, c.content, pgroonga_score(c.tableoid, c.ctid) AS score
         FROM library_chunks c
        WHERE c.org_id = $1 AND c.content &@~ $2
     ),
     best AS (
       SELECT DISTINCT ON (item_id) item_id, page, content, score,
              sum(score) OVER (PARTITION BY item_id) AS total
         FROM passage_hits ORDER BY item_id, score DESC
     ),
     -- Items with no passages yet (pending, or unreadable like a photo) are found by their title.
     title_hits AS (
       SELECT i.id AS item_id, pgroonga_score(i.tableoid, i.ctid) AS score
         FROM library_items i
        WHERE i.org_id = $1 AND i.title &@~ $2
          AND NOT EXISTS (SELECT 1 FROM library_chunks c WHERE c.item_id = i.id)
     )
     SELECT ${ITEM_COLUMNS},
            pgroonga_snippet_html(coalesce(b.content, i.content), pgroonga_query_extract_keywords($2), 200) AS snippet,
            b.page, b.content AS passage,
            (coalesce(b.score, 0) + coalesce(b.total, 0) * 0.2 + coalesce(t.score, 0))::float AS score
       FROM ${ITEM_FROM}
       LEFT JOIN best b ON b.item_id = i.id
       LEFT JOIN title_hits t ON t.item_id = i.id
      WHERE i.org_id = $1 AND (b.item_id IS NOT NULL OR t.item_id IS NOT NULL)${where}
      ORDER BY score DESC, i.created_at DESC
      LIMIT $${params.push(limit)}`,
    params,
  );
  return rows.map((r) => ({
    ...toItem(r),
    snippet: (r.snippet?.[0] ?? "").replace(/<span class="keyword">/g, "<mark>").replace(/<\/span>/g, "</mark>"),
    passage: r.passage ?? "",
    page: r.page,
    score: r.score,
  }));
}

/** How much is in the Library, and how much is still waiting to be read. */
export async function libraryCounts(orgId: string): Promise<{ total: number; pending: number; skipped: number }> {
  const row = await queryOne<{ total: number; pending: number; skipped: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'pending')::int AS pending,
            count(*) FILTER (WHERE status IN ('skipped', 'failed'))::int AS skipped
       FROM library_items WHERE org_id = $1`,
    [orgId],
  );
  return row ?? { total: 0, pending: 0, skipped: 0 };
}
