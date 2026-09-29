import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getInvoiceDocument } from "@/lib/email-invoice";
import { readUpload } from "@/lib/storage";

/** Downloads one of an invoice's source documents (the parsed PDF/image, or the original email as .eml) — gated by the invoice's org. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string; documentId: string }> },
) {
  const { invoiceId, documentId } = await params;
  const { org } = await requireSession();
  const doc = await getInvoiceDocument(documentId, invoiceId, org.id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await readUpload(doc.filePath);
  const filename = doc.fileName.replace(/["\\\r\n]/g, "_");
  // PDFs and images open in the browser; anything else (like .eml) downloads.
  const inline = doc.contentType === "application/pdf" || doc.contentType.startsWith("image/");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": doc.contentType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
