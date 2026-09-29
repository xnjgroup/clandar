/**
 * A project's photos and other files — the quoting flow's input, and part of
 * the project record afterward. Bytes live on disk (lib/storage.ts); these
 * rows are the pointers, always reached through a project that's already been
 * checked against the caller's org (see app/(dashboard)/projects/[id]/actions.ts
 * and the streaming routes under app/api/projects).
 */
import { query, queryOne } from "@/lib/db";
import { deleteUpload, readUpload, saveUpload } from "@/lib/storage";

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
  filePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
};

export async function listProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const rows = await query<{
    id: string;
    project_id: string;
    file_path: string;
    file_name: string;
    content_type: string;
    size_bytes: number;
    created_at: Date;
  }>(
    `SELECT id, project_id, file_path, file_name, content_type, size_bytes, created_at
       FROM project_files WHERE project_id = $1 ORDER BY created_at`,
    [projectId],
  );
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    filePath: r.file_path,
    fileName: r.file_name,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
  }));
}

export async function getProjectFile(id: string, projectId: string): Promise<ProjectFile | null> {
  const row = await queryOne<{
    id: string;
    project_id: string;
    file_path: string;
    file_name: string;
    content_type: string;
    size_bytes: number;
    created_at: Date;
  }>(
    `SELECT id, project_id, file_path, file_name, content_type, size_bytes, created_at
       FROM project_files WHERE id = $1 AND project_id = $2`,
    [id, projectId],
  );
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    filePath: row.file_path,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

export async function addProjectFile(input: {
  projectId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  uploadedBy: string | null;
}): Promise<string> {
  const filePath = await saveUpload("project-files", input.projectId, input.fileName, input.bytes);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO project_files (project_id, file_path, file_name, content_type, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.projectId, filePath, input.fileName, input.contentType, input.bytes.byteLength, input.uploadedBy],
  );
  return row!.id;
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
