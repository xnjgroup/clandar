/**
 * A job's photos and other files — the quoting flow's input, and part of the
 * project record afterward. Bytes live on disk (lib/storage.ts); these rows
 * are the pointers, always reached through a job that's already been checked
 * against the caller's org (see app/(dashboard)/jobs/[id]/actions.ts and the
 * streaming routes under app/api/jobs).
 */
import { query, queryOne } from "@/lib/db";
import { deleteUpload, readUpload, saveUpload } from "@/lib/storage";

export type JobPhoto = {
  id: string;
  jobId: string;
  filePath: string;
  contentType: string;
  sizeBytes: number;
  caption: string | null;
  createdAt: Date;
};

export async function listJobPhotos(jobId: string): Promise<JobPhoto[]> {
  const rows = await query<{
    id: string;
    job_id: string;
    file_path: string;
    content_type: string;
    size_bytes: number;
    caption: string | null;
    created_at: Date;
  }>(
    `SELECT id, job_id, file_path, content_type, size_bytes, caption, created_at
       FROM job_photos WHERE job_id = $1 ORDER BY created_at`,
    [jobId],
  );
  return rows.map((r) => ({
    id: r.id,
    jobId: r.job_id,
    filePath: r.file_path,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    caption: r.caption,
    createdAt: r.created_at,
  }));
}

export async function getJobPhoto(id: string, jobId: string): Promise<JobPhoto | null> {
  const row = await queryOne<{
    id: string;
    job_id: string;
    file_path: string;
    content_type: string;
    size_bytes: number;
    caption: string | null;
    created_at: Date;
  }>(
    `SELECT id, job_id, file_path, content_type, size_bytes, caption, created_at
       FROM job_photos WHERE id = $1 AND job_id = $2`,
    [id, jobId],
  );
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    filePath: row.file_path,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    caption: row.caption,
    createdAt: row.created_at,
  };
}

export async function addJobPhoto(input: {
  jobId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  uploadedBy: string | null;
}): Promise<string> {
  const filePath = await saveUpload("job-photos", input.jobId, input.fileName, input.bytes);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO job_photos (job_id, file_path, content_type, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.jobId, filePath, input.contentType, input.bytes.byteLength, input.uploadedBy],
  );
  return row!.id;
}

export async function readJobPhotoBytes(photo: JobPhoto): Promise<Buffer> {
  return readUpload(photo.filePath);
}

export async function deleteJobPhoto(id: string, jobId: string): Promise<void> {
  const photo = await getJobPhoto(id, jobId);
  if (!photo) return;
  await query(`DELETE FROM job_photos WHERE id = $1`, [id]);
  await deleteUpload(photo.filePath);
}

/* ── Files ────────────────────────────────────────────────── */

export type JobFile = {
  id: string;
  jobId: string;
  filePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
};

export async function listJobFiles(jobId: string): Promise<JobFile[]> {
  const rows = await query<{
    id: string;
    job_id: string;
    file_path: string;
    file_name: string;
    content_type: string;
    size_bytes: number;
    created_at: Date;
  }>(
    `SELECT id, job_id, file_path, file_name, content_type, size_bytes, created_at
       FROM job_files WHERE job_id = $1 ORDER BY created_at`,
    [jobId],
  );
  return rows.map((r) => ({
    id: r.id,
    jobId: r.job_id,
    filePath: r.file_path,
    fileName: r.file_name,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
  }));
}

export async function getJobFile(id: string, jobId: string): Promise<JobFile | null> {
  const row = await queryOne<{
    id: string;
    job_id: string;
    file_path: string;
    file_name: string;
    content_type: string;
    size_bytes: number;
    created_at: Date;
  }>(
    `SELECT id, job_id, file_path, file_name, content_type, size_bytes, created_at
       FROM job_files WHERE id = $1 AND job_id = $2`,
    [id, jobId],
  );
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    filePath: row.file_path,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

export async function addJobFile(input: {
  jobId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  uploadedBy: string | null;
}): Promise<string> {
  const filePath = await saveUpload("job-files", input.jobId, input.fileName, input.bytes);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO job_files (job_id, file_path, file_name, content_type, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.jobId, filePath, input.fileName, input.contentType, input.bytes.byteLength, input.uploadedBy],
  );
  return row!.id;
}

export async function readJobFileBytes(file: JobFile): Promise<Buffer> {
  return readUpload(file.filePath);
}

export async function deleteJobFile(id: string, jobId: string): Promise<void> {
  const file = await getJobFile(id, jobId);
  if (!file) return;
  await query(`DELETE FROM job_files WHERE id = $1`, [id]);
  await deleteUpload(file.filePath);
}
