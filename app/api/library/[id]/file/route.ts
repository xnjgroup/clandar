import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { getLibraryItem } from "@/lib/library";
import { readUpload } from "@/lib/storage";

/** Streams a Library document's bytes (a project's file or one uploaded to the Library) — org-gated. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The website's cookie or the app's bearer token (no redirect to sign-in for the app).
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const item = await getLibraryItem(id, session.org.id);
  if (!item?.filePath) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await readUpload(item.filePath);
  const filename = (item.fileName ?? item.title).replace(/["\\]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": item.contentType ?? "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "content-disposition": `inline; filename="${filename}"`,
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
