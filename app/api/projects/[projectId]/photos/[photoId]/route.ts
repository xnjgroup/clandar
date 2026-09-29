import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { getProjectPhoto, readProjectPhotoBytes } from "@/lib/project-photos";

/** Streams one project photo's bytes — gated by the project actually belonging to the signed-in org. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; photoId: string }> },
) {
  const { projectId, photoId } = await params;
  const { org } = await requireSession();

  const project = await getProject(projectId, org.id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const photo = await getProjectPhoto(photoId, projectId);
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await readProjectPhotoBytes(photo);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": photo.contentType,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
