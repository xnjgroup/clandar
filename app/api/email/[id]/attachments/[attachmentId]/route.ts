import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { GmailError, readAttachment, readMail } from "@/lib/gmail";

/**
 * Streams one Gmail attachment through the server, so the browser never needs a
 * Google token. `Content-Disposition: inline` lets a PDF or image open in a tab;
 * anything else the browser cannot display it will download.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const { id, attachmentId } = await params;
  // Which Gmail account this message belongs to — omitted when only one is
  // connected, in which case readMail/readAttachment default to it.
  const connectorId = request.nextUrl.searchParams.get("account") ?? undefined;
  const { org } = await requireSession();

  try {
    const message = await readMail(id, org.id, connectorId);
    const attachment = message.attachments.find((a) => a.attachmentId === attachmentId);
    if (!attachment) {
      return NextResponse.json({ error: "No such attachment on this message" }, { status: 404 });
    }

    const bytes = await readAttachment(id, attachmentId, org.id, connectorId);
    // Quote-escape the filename so a comma or quote cannot break the header.
    const filename = attachment.filename.replace(/["\\]/g, "_");

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": attachment.mimeType,
        "content-length": String(bytes.byteLength),
        "content-disposition": `inline; filename="${filename}"`,
        // The bytes are someone else's file: never let it run as a page.
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof GmailError ? error.message : "Could not read the attachment";
    const status = error instanceof GmailError && error.reconnect ? 401 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
