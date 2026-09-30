import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { addProjectPhoto } from "@/lib/project-photos";

/** Uploads one photo to a project — see ../files/route.ts for why this is a route rather than a server action. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const session = await requireSession();
  const project = await getProject(projectId, session.org.id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = (await request.formData()).get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a photo first." }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Only image files are supported." }, { status: 400 });

  const id = await addProjectPhoto({
    projectId,
    fileName: file.name,
    contentType: file.type,
    bytes: Buffer.from(await file.arrayBuffer()),
    uploadedBy: session.person.id,
  });
  revalidatePath(`/projects/${projectId}`);
  return NextResponse.json({ id });
}
