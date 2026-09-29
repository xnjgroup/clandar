/**
 * Local-disk storage for job photos and files. Stored under `UPLOADS_DIR`
 * (default `.uploads/` at the repo root, gitignored), one subfolder per
 * category+owner id — nothing fancier than that, since this is a single-server
 * deployment, not a multi-instance one.
 *
 * A stored path is never trusted from the client: every read/delete goes
 * through a DB row first (job_photos/job_files), whose own org check is what
 * actually gates access — see app/api/jobs/[jobId]/photos and /files.
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

function root(): string {
  return process.env.UPLOADS_DIR || join(process.cwd(), ".uploads");
}

/** Strips path separators and anything but safe filename characters, and caps length. */
function safeSegment(value: string): string {
  return value.replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "file";
}

export async function saveUpload(
  category: string,
  ownerId: string,
  fileName: string,
  bytes: Buffer,
): Promise<string> {
  // turbopackIgnore: the runtime-configurable root (UPLOADS_DIR) means the
  // build can't statically bound this path to a subfolder — the whole-project
  // trace that triggers is harmless here (this app runs as a persistent
  // Node server, not a size-capped serverless function).
  const dir = join(/*turbopackIgnore: true*/ root(), safeSegment(category), safeSegment(ownerId));
  await mkdir(dir, { recursive: true });
  const storedName = `${crypto.randomUUID()}-${safeSegment(fileName)}`;
  await writeFile(join(dir, storedName), bytes);
  return join(safeSegment(category), safeSegment(ownerId), storedName);
}

export async function readUpload(relativePath: string): Promise<Buffer> {
  return readFile(join(/*turbopackIgnore: true*/ root(), relativePath));
}

export async function deleteUpload(relativePath: string): Promise<void> {
  await unlink(join(/*turbopackIgnore: true*/ root(), relativePath)).catch(() => {});
}
