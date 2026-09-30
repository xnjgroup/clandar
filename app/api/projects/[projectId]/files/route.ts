import { revalidatePath } from "next/cache";
import { NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { DOC_TYPES, type DocType } from "@/lib/doc-types";
import { markParsePending, parseProjectDocument } from "@/lib/document-ingest";
import { addProjectFile, ensureProjectFolderPath, getProjectFolder, parseTags } from "@/lib/project-photos";

/**
 * Uploads one file to a project. A plain route (not a server action) so the
 * browser can post it with XMLHttpRequest and show upload progress; the
 * uploader sends one request per file.
 *
 * Optional fields: `folderId` (the folder being viewed; blank = top level),
 * `relativePath` (the file's folder path inside an uploaded directory, e.g.
 * "Site visit/Photos" — recreated under `folderId`), `tags`
 * (comma-separated), and `docType` — an invoice or receipt gets read into an
 * invoice record after the response goes out (see lib/document-ingest.ts).
 */
// Room for the post-response LLM parse of an invoice/receipt (`after` runs within this budget).
export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const session = await requireSession();
  const project = await getProject(projectId, session.org.id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file first." }, { status: 400 });

  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  let folderId: string | null = text("folderId") || null;
  if (folderId && !(await getProjectFolder(folderId, projectId))) {
    return NextResponse.json({ error: "That folder no longer exists." }, { status: 400 });
  }
  const docTypeField = text("docType");
  const docType: DocType = DOC_TYPES.some((d) => d.id === docTypeField) ? (docTypeField as DocType) : "general";
  const relativePath = text("relativePath");
  if (relativePath) folderId = await ensureProjectFolderPath(projectId, folderId, relativePath);

  const id = await addProjectFile({
    projectId,
    folderId,
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    bytes: Buffer.from(await file.arrayBuffer()),
    uploadedBy: session.person.id,
    tags: parseTags(text("tags")),
    docType,
  });
  if (docType !== "general") {
    await markParsePending(id);
    after(() => parseProjectDocument(id, projectId, session.org.id));
  }
  revalidatePath(`/projects/${projectId}`);
  return NextResponse.json({ id });
}
