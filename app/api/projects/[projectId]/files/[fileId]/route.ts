import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { getProjectFile, readProjectFileBytes } from "@/lib/project-photos";

/** Streams one project file's bytes — gated by the project actually belonging to the signed-in org. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; fileId: string }> },
) {
  const { projectId, fileId } = await params;
  const { org } = await requireSession();

  const project = await getProject(projectId, org.id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = await getProjectFile(fileId, projectId);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await readProjectFileBytes(file);
  const filename = file.fileName.replace(/["\\]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": file.contentType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `inline; filename="${filename}"`,
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
