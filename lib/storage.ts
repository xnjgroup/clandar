/**
 * File storage for project photos/files and assistant chat attachments —
 * Cloudflare R2 (S3-compatible) when `R2_*` env vars are configured, falling
 * back to local disk under `UPLOADS_DIR` (default `.uploads/` at the repo
 * root, gitignored) otherwise, same as before R2 support existed. Either way
 * callers just get back an opaque key/relative path; one subfolder per
 * category+owner id.
 *
 * A stored path is never trusted from the client: every read/delete goes
 * through a DB row first (project_photos/project_files, agent_message_attachments),
 * whose own org check is what actually gates access — see
 * app/api/projects/[projectId]/{photos,files} and app/api/assistant/attachments.
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);
  if (!endpoint) return null;
  return { endpoint, accessKeyId, secretAccessKey, bucket };
}

let cachedClient: S3Client | null = null;
function r2Client(config: NonNullable<ReturnType<typeof r2Config>>): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }
  return cachedClient;
}

function localRoot(): string {
  return process.env.UPLOADS_DIR || join(process.cwd(), ".uploads");
}

/** Strips path separators and anything but safe filename characters, and caps length. */
function safeSegment(value: string): string {
  return value.replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "file";
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function saveUpload(
  category: string,
  ownerId: string,
  fileName: string,
  bytes: Buffer,
): Promise<string> {
  const key = `${safeSegment(category)}/${safeSegment(ownerId)}/${crypto.randomUUID()}-${safeSegment(fileName)}`;

  const r2 = r2Config();
  if (r2) {
    await r2Client(r2).send(new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: bytes }));
    return key;
  }

  // turbopackIgnore: the runtime-configurable root (UPLOADS_DIR) means the
  // build can't statically bound this path to a subfolder — the whole-project
  // trace that triggers is harmless here (this app runs as a persistent
  // Node server, not a size-capped serverless function).
  const dir = join(/*turbopackIgnore: true*/ localRoot(), safeSegment(category), safeSegment(ownerId));
  await mkdir(dir, { recursive: true });
  await writeFile(join(localRoot(), key), bytes);
  return key;
}

export async function readUpload(key: string): Promise<Buffer> {
  const r2 = r2Config();
  if (r2) {
    const result = await r2Client(r2).send(new GetObjectCommand({ Bucket: r2.bucket, Key: key }));
    return streamToBuffer(result.Body);
  }
  return readFile(join(/*turbopackIgnore: true*/ localRoot(), key));
}

export async function deleteUpload(key: string): Promise<void> {
  const r2 = r2Config();
  if (r2) {
    await r2Client(r2)
      .send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }))
      .catch(() => {});
    return;
  }
  await unlink(join(/*turbopackIgnore: true*/ localRoot(), key)).catch(() => {});
}
