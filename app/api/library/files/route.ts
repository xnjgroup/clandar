import { revalidatePath } from "next/cache";
import { NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth";
import { addLibraryFile, indexLibraryItem } from "@/lib/library";
import { parseTags } from "@/lib/project-photos";

/** Uploads one document to the Library (one request per file, like project files), then indexes it. */
export const maxDuration = 120;

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await requireSession();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file first." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `${file.name} is over 50 MB.` }, { status: 400 });
  const tags = form.get("tags");
  const id = await addLibraryFile({
    orgId: session.org.id,
    folderId: null,
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    bytes: Buffer.from(await file.arrayBuffer()),
    createdBy: session.person.id,
    tags: parseTags(typeof tags === "string" ? tags : ""),
  });
  // Read and index it once the response has gone out.
  after(() => indexLibraryItem(id).then(() => revalidatePath("/library")));
  revalidatePath("/library");
  return NextResponse.json({ id });
}
