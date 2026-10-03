import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { getLibraryItem } from "@/lib/library";
import { readUpload } from "@/lib/storage";

/** One of a saved article's pictures (its stored copy) — the website's cookie or the app's token. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d+$/.test(n)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const item = await getLibraryItem(id, session.org.id);
  const image = item?.images[Number(n)];
  if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await readUpload(image.key);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": image.type.startsWith("image/") && !image.type.includes("svg") ? image.type : "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "x-content-type-options": "nosniff",
      // Stored copies never change for a given id/index.
      "cache-control": "private, max-age=86400",
    },
  });
}
