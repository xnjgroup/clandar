import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { emlAttachment } from "@/lib/eml";
import { getInvoiceDocument } from "@/lib/email-invoice";
import { readUpload } from "@/lib/storage";

/** One attachment from inside a saved original email (.eml) — gated by the invoice's org like the document itself. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string; documentId: string; index: string }> },
) {
  const { invoiceId, documentId, index } = await params;
  const { org } = await requireSession();
  const doc = await getInvoiceDocument(documentId, invoiceId, org.id);
  if (!doc || doc.contentType !== "message/rfc822" || !/^\d+$/.test(index)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const part = await emlAttachment(await readUpload(doc.filePath), Number(index));
  if (!part) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filename = part.filename.replace(/["\\\r\n]/g, "_");
  const inline = part.mimeType === "application/pdf" || part.mimeType.startsWith("image/");
  return new NextResponse(new Uint8Array(part.bytes), {
    headers: {
      "content-type": part.mimeType || "application/octet-stream",
      "content-length": String(part.bytes.byteLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      // Someone else's file: never let it run as a page.
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
