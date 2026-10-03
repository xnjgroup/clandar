/**
 * A project's photos and other files — the quoting flow's input, and part of
 * the project record afterward. Bytes live on disk (lib/storage.ts); these
 * rows are the pointers, always reached through a project that's already been
 * checked against the caller's org (see app/(dashboard)/projects/[id]/actions.ts
 * and the streaming routes under app/api/projects).
 */
import { query, queryOne } from "@/lib/db";
import type { DocType } from "@/lib/doc-types";
import { deleteUpload, readUpload, saveUpload } from "@/lib/storage";
import { after } from "next/server";
import { indexProjectFile } from "@/lib/library";

export type ProjectPhoto = {
  id: string;
  projectId: string;
  filePath: string;
  contentType: string;
  sizeBytes: number;
  caption: string | null;
  createdAt: Date;
};

export async function listProjectPhotos(projectId: string): Promise<ProjectPhoto[]> {
  const rows = await query<{
    id: string;
    project_id: string;
    file_path: string;
    content_type: string;
    size_bytes: number;
    caption: string | null;
    created_at: Date;
  }>(
    `SELECT id, project_id, file_path, content_type, size_bytes, caption, created_at
       FROM project_photos WHERE project_id = $1 ORDER BY created_at`,
    [projectId],
  );
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    filePath: r.file_path,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    caption: r.caption,
    createdAt: r.created_at,
  }));
}

export async function getProjectPhoto(id: string, projectId: string): Promise<ProjectPhoto | null> {
  const row = await queryOne<{
    id: string;
    project_id: string;
    file_path: string;
    content_type: string;
    size_bytes: number;
    caption: string | null;
    created_at: Date;
  }>(
    `SELECT id, project_id, file_path, content_type, size_bytes, caption, created_at
       FROM project_photos WHERE id = $1 AND project_id = $2`,
    [id, projectId],
  );
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    filePath: row.file_path,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    caption: row.caption,
    createdAt: row.created_at,
  };
}

export async function addProjectPhoto(input: {
  projectId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  uploadedBy: string | null;
}): Promise<string> {
  const filePath = await saveUpload("project-photos", input.projectId, input.fileName, input.bytes);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO project_photos (project_id, file_path, content_type, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.projectId, filePath, input.contentType, input.bytes.byteLength, input.uploadedBy],
  );
  return row!.id;
}

export async function readProjectPhotoBytes(photo: ProjectPhoto): Promise<Buffer> {
  return readUpload(photo.filePath);
}

export async function deleteProjectPhoto(id: string, projectId: string): Promise<void> {
  const photo = await getProjectPhoto(id, projectId);
  if (!photo) return;
  await query(`DELETE FROM project_photos WHERE id = $1`, [id]);
  await deleteUpload(photo.filePath);
}

/* ── Files ────────────────────────────────────────────────── */

export type ProjectFile = {
  id: string;
  projectId: string;
  folderId: string | null;
  filePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  tags: string[];
  docType: DocType;
  parseStatus: "pending" | "done" | "failed" | null;
  parseError: string | null;
  /** The invoice parsed from this file, with what its page URL needs. */
  invoice: { id: string; vendorSlug: string; vendorName: string; accountNumber: string | null; amount: number } | null;
  createdAt: Date;
};

type FileRow = {
  id: string;
  project_id: string;
  folder_id: string | null;
  file_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  tags: string[];
  doc_type: DocType;
  parse_status: "pending" | "done" | "failed" | null;
  parse_error: string | null;
  invoice_id: string | null;
  invoice_vendor_slug: string | null;
  invoice_vendor_name: string | null;
  invoice_account_number: string | null;
  invoice_amount: string | null;
  created_at: Date;
};

function toFile(r: FileRow): ProjectFile {
  return {
    id: r.id,
    projectId: r.project_id,
    folderId: r.folder_id,
    filePath: r.file_path,
    fileName: r.file_name,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    tags: r.tags,
    docType: r.doc_type,
    parseStatus: r.parse_status,
    parseError: r.parse_error,
    invoice:
      r.invoice_id && r.invoice_vendor_slug
        ? {
            id: r.invoice_id,
            vendorSlug: r.invoice_vendor_slug,
            vendorName: r.invoice_vendor_name ?? "",
            accountNumber: r.invoice_account_number,
            amount: Number(r.invoice_amount),
          }
        : null,
    createdAt: r.created_at,
  };
}

const FILE_COLUMNS = `project_files.id, project_id, folder_id, file_path, file_name, content_type, size_bytes, tags,
  doc_type, parse_status, parse_error, invoice_id,
  inv.vendor_slug AS invoice_vendor_slug, inv.vendor_name AS invoice_vendor_name,
  inv.account_number AS invoice_account_number, inv.amount AS invoice_amount,
  created_at`;

/** project_files plus the invoice parsed from each one (if any) — `inv` columns only; no name clashes with project_files. */
const FILE_FROM = `project_files LEFT JOIN LATERAL (
    SELECT v.slug AS vendor_slug, v.name AS vendor_name, i.account_number, i.amount::text AS amount
      FROM invoices i JOIN vendors v ON v.id = i.vendor_id
     WHERE i.id = project_files.invoice_id
  ) inv ON true`;

/** The files directly inside one folder (`null` = the project's top level). */
export async function listProjectFiles(projectId: string, folderId: string | null = null): Promise<ProjectFile[]> {
  const rows = await query<FileRow>(
    `SELECT ${FILE_COLUMNS} FROM ${FILE_FROM}
      WHERE project_id = $1 AND folder_id IS NOT DISTINCT FROM $2
      ORDER BY lower(file_name), created_at`,
    [projectId, folderId],
  );
  return rows.map(toFile);
}

/** Every file in the project regardless of folder — for picking email attachments. */
export async function listAllProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const rows = await query<FileRow>(
    `SELECT ${FILE_COLUMNS} FROM ${FILE_FROM} WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId],
  );
  return rows.map(toFile);
}

/** Every file in the project carrying `tag`, whatever folder it's in. */
export async function listProjectFilesByTag(projectId: string, tag: string): Promise<ProjectFile[]> {
  const rows = await query<FileRow>(
    `SELECT ${FILE_COLUMNS} FROM ${FILE_FROM}
      WHERE project_id = $1 AND $2 = ANY (tags)
      ORDER BY lower(file_name), created_at`,
    [projectId, tag],
  );
  return rows.map(toFile);
}

/** The distinct tags in use across the project's files, for the tag filter. */
export async function listProjectFileTags(projectId: string): Promise<string[]> {
  const rows = await query<{ tag: string }>(
    `SELECT DISTINCT unnest(tags) AS tag FROM project_files WHERE project_id = $1 ORDER BY 1`,
    [projectId],
  );
  return rows.map((r) => r.tag);
}

/** Lowercases, trims and dedupes a comma-separated tag list. */
export function parseTags(input: string): string[] {
  return [...new Set(input.split(",").map((t) => t.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 20);
}

export async function setProjectFileTags(id: string, projectId: string, tags: string[]): Promise<void> {
  await query(`UPDATE project_files SET tags = $3 WHERE id = $1 AND project_id = $2`, [id, projectId, tags]);
}

export async function getProjectFile(id: string, projectId: string): Promise<ProjectFile | null> {
  const row = await queryOne<FileRow>(`SELECT ${FILE_COLUMNS} FROM ${FILE_FROM} WHERE id = $1 AND project_id = $2`, [
    id,
    projectId,
  ]);
  return row ? toFile(row) : null;
}

/** `folderId` must already be checked as belonging to `projectId` (see getProjectFolder). */
export async function addProjectFile(input: {
  projectId: string;
  folderId: string | null;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  uploadedBy: string | null;
  tags?: string[];
  docType?: DocType;
}): Promise<string> {
  const filePath = await saveUpload("project-files", input.projectId, input.fileName, input.bytes);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO project_files (project_id, folder_id, file_path, file_name, content_type, size_bytes, uploaded_by, tags, doc_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      input.projectId,
      input.folderId,
      filePath,
      input.fileName,
      input.contentType,
      input.bytes.byteLength,
      input.uploadedBy,
      input.tags ?? [],
      input.docType ?? "general",
    ],
  );
  // Into the Library (lib/library.ts): mirrored and made searchable once the response has gone.
  const id = row!.id;
  try {
    after(() => indexProjectFile(id).catch((error) => console.error("[library] index", error)));
  } catch {
    // Outside a request (a script): the next Library sync picks it up.
  }
  return id;
}

export async function readProjectFileBytes(file: ProjectFile): Promise<Buffer> {
  return readUpload(file.filePath);
}

export async function deleteProjectFile(id: string, projectId: string): Promise<void> {
  const file = await getProjectFile(id, projectId);
  if (!file) return;
  await query(`DELETE FROM project_files WHERE id = $1`, [id]);
  await deleteUpload(file.filePath);
}

/** `folderId` must already be checked as belonging to `projectId`. */
export async function moveProjectFile(id: string, projectId: string, folderId: string | null): Promise<void> {
  await query(`UPDATE project_files SET folder_id = $3 WHERE id = $1 AND project_id = $2`, [id, projectId, folderId]);
}

export async function setProjectFileDocType(id: string, projectId: string, docType: DocType): Promise<void> {
  await query(`UPDATE project_files SET doc_type = $3 WHERE id = $1 AND project_id = $2`, [id, projectId, docType]);
}

/* ── Folders ──────────────────────────────────────────────── */

export type ProjectFolder = {
  id: string;
  parentId: string | null;
  name: string;
  /** How many files and subfolders sit directly inside it. */
  itemCount: number;
};

/** Every folder in the project — few enough to fetch at once and build breadcrumbs/paths from. */
export async function listProjectFolders(projectId: string): Promise<ProjectFolder[]> {
  const rows = await query<{ id: string; parent_id: string | null; name: string; item_count: number }>(
    `SELECT f.id, f.parent_id, f.name,
            ((SELECT count(*) FROM project_files x WHERE x.folder_id = f.id)
             + (SELECT count(*) FROM project_folders c WHERE c.parent_id = f.id))::int AS item_count
       FROM project_folders f WHERE f.project_id = $1
      ORDER BY lower(f.name)`,
    [projectId],
  );
  return rows.map((r) => ({ id: r.id, parentId: r.parent_id, name: r.name, itemCount: r.item_count }));
}

/** The folder, only if it belongs to this project — the check every folder id from a form goes through. */
export async function getProjectFolder(id: string, projectId: string): Promise<{ id: string } | null> {
  return queryOne<{ id: string }>(`SELECT id FROM project_folders WHERE id = $1 AND project_id = $2`, [id, projectId]);
}

/** Finds the named subfolder of `parentId`, creating it if needed (names match case-insensitively). */
export async function ensureProjectFolder(projectId: string, parentId: string | null, name: string): Promise<string> {
  const clean = name.replace(/[/\\]/g, "-").trim().slice(0, 120) || "Untitled";
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM project_folders
      WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND lower(name) = lower($3)`,
    [projectId, parentId, clean],
  );
  if (existing) return existing.id;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO project_folders (project_id, parent_id, name) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING id`,
    [projectId, parentId, clean],
  );
  // Lost a race with a concurrent upload creating the same folder — use theirs.
  return row?.id ?? (await ensureProjectFolder(projectId, parentId, clean));
}

/** Walks/creates a slash-separated path like "Permits/2026" under `parentId`, returning the deepest folder. */
export async function ensureProjectFolderPath(
  projectId: string,
  parentId: string | null,
  path: string,
): Promise<string | null> {
  let current = parentId;
  for (const segment of path.split("/").filter((s) => s.trim())) {
    current = await ensureProjectFolder(projectId, current, segment);
  }
  return current;
}

export async function renameProjectFolder(id: string, projectId: string, name: string): Promise<void> {
  await query(`UPDATE project_folders SET name = $3 WHERE id = $1 AND project_id = $2`, [id, projectId, name]);
}

/** Deletes a folder only when it's empty — returns false (and leaves it) otherwise. */
export async function deleteProjectFolder(id: string, projectId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM project_folders f
      WHERE f.id = $1 AND f.project_id = $2
        AND NOT EXISTS (SELECT 1 FROM project_files x WHERE x.folder_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM project_folders c WHERE c.parent_id = f.id)
      RETURNING f.id`,
    [id, projectId],
  );
  return rows.length > 0;
}
