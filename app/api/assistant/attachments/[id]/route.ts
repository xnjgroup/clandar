import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getAttachment } from "@/lib/assistant";
import { readUpload } from "@/lib/storage";

/** Streams one chat attachment's bytes — gated by its conversation actually belonging to the signed-in org. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await requireSession();

  const attachment = await getAttachment(id, org.id);
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await readUpload(attachment.filePath);
  const filename = attachment.fileName.replace(/["\\]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": attachment.contentType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
