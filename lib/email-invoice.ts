/**
 * Records an invoice/receipt that arrived by email: reads it (the attached
 * PDF/image when there is one, otherwise the email's own text) with the same
 * parser as project uploads (lib/document-ingest.ts), writes the invoice, and
 * keeps the source — the attachment and the original email as .eml — as the
 * invoice's documents. Used by the chat assistant's record_email_invoice tool.
 */
import { query, queryOne, transaction } from "@/lib/db";
import { htmlToText } from "@/lib/email-context";
import { insertInvoice, readInvoiceDocument, type InvoiceSource } from "@/lib/document-ingest";
import { readAttachment, readRawMail, type MailDetail } from "@/lib/gmail";
import { saveUpload } from "@/lib/storage";

/** Attachment types the parser can read, best first. */
const READABLE = [/^application\/pdf$/, /^image\//, /wordprocessingml|spreadsheetml/, /^text\//];

function rank(mimeType: string, fileName: string): number {
  const type = mimeType === "application/octet-stream" && /\.pdf$/i.test(fileName) ? "application/pdf" : mimeType;
  const i = READABLE.findIndex((r) => r.test(type));
  return i === -1 ? Infinity : i;
}

export type RecordedInvoice = {
  invoiceId: string;
  vendorName: string;
  vendorSlug: string;
  total: number;
  invoiceDate: string;
  dueDate: string | null;
  lineItemCount: number;
  source: string;
  documents: string[];
};

export async function recordInvoiceFromEmail(input: {
  orgId: string;
  message: MailDetail;
  docType: "invoice" | "receipt";
  projectId: string | null;
  /** Prefer this attachment (by filename, case-insensitive); otherwise the most readable one, else the email text. */
  attachmentName?: string;
}): Promise<RecordedInvoice> {
  const { orgId, message, docType } = input;

  const wanted = input.attachmentName?.toLowerCase();
  const candidates = message.attachments
    .filter((a) => rank(a.mimeType, a.filename) !== Infinity)
    .sort((a, b) => rank(a.mimeType, a.filename) - rank(b.mimeType, b.filename));
  const attachment =
    (wanted && message.attachments.find((a) => a.filename.toLowerCase() === wanted)) || candidates[0] || null;

  let source: InvoiceSource;
  let attachmentBytes: Buffer | null = null;
  // Some senders label PDFs as octet-stream; trust the extension then.
  const attachmentType =
    attachment?.mimeType === "application/octet-stream" && /\.pdf$/i.test(attachment.filename)
      ? "application/pdf"
      : (attachment?.mimeType ?? "");
  if (attachment) {
    attachmentBytes = await readAttachment(message.id, attachment.attachmentId, orgId, message.connectorId);
    source = { fileName: attachment.filename, contentType: attachmentType, bytes: attachmentBytes };
  } else {
    const text = message.text?.trim() || (message.html ? htmlToText(message.html) : "") || message.snippet;
    source = { fileName: `Email: ${message.subject}`, text: `From: ${message.from} <${message.fromEmail}>\n\n${text}` };
  }

  const data = await readInvoiceDocument(orgId, docType, source);
  const raw = await readRawMail(message.id, orgId, message.connectorId);

  const invoiceId = await transaction((client) =>
    insertInvoice(client, orgId, data, {
      projectId: input.projectId,
      docType,
      submittedBy: `From email: ${message.fromEmail} — ${message.subject}`,
    }),
  );

  // Keep the source documents with the record. Stored after the invoice exists (storage isn't transactional).
  const documents: { name: string; contentType: string; bytes: Buffer }[] = [];
  if (attachment && attachmentBytes) {
    documents.push({ name: attachment.filename, contentType: attachmentType, bytes: attachmentBytes });
  }
  const emlName = `${(message.subject || "email").replace(/[^\w .-]+/g, "_").slice(0, 80).trim() || "email"}.eml`;
  documents.push({ name: emlName, contentType: "message/rfc822", bytes: raw });
  for (const doc of documents) {
    const filePath = await saveUpload("invoice-documents", invoiceId, doc.name, doc.bytes);
    await query(
      `INSERT INTO invoice_documents (invoice_id, file_path, file_name, content_type, size_bytes) VALUES ($1, $2, $3, $4, $5)`,
      [invoiceId, filePath, doc.name, doc.contentType, doc.bytes.byteLength],
    );
  }

  const vendor = await queryOne<{ slug: string }>(
    `SELECT v.slug FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = $1`,
    [invoiceId],
  );
  return {
    invoiceId,
    vendorName: data.vendorName,
    vendorSlug: vendor?.slug ?? "",
    total: data.total,
    invoiceDate: data.invoiceDate,
    dueDate: data.dueDate,
    lineItemCount: data.lineItems.length,
    source: attachment ? attachment.filename : "the email text",
    documents: documents.map((d) => d.name),
  };
}

/** Links an invoice to a project (or unlinks it with null); the project must be in the same org. */
export async function setInvoiceProject(invoiceId: string, orgId: string, projectId: string | null): Promise<void> {
  await query(
    `UPDATE invoices SET project_id = $3
      WHERE id = $1 AND org_id = $2
        AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = $3 AND org_id = $2))`,
    [invoiceId, orgId, projectId],
  );
}

export type InvoiceDocument = { id: string; fileName: string; contentType: string; sizeBytes: number };

export async function listInvoiceDocuments(invoiceId: string, orgId: string): Promise<InvoiceDocument[]> {
  const rows = await query<{ id: string; file_name: string; content_type: string; size_bytes: number }>(
    `SELECT d.id, d.file_name, d.content_type, d.size_bytes
       FROM invoice_documents d JOIN invoices i ON i.id = d.invoice_id
      WHERE d.invoice_id = $1 AND i.org_id = $2 ORDER BY d.created_at`,
    [invoiceId, orgId],
  );
  return rows.map((r) => ({ id: r.id, fileName: r.file_name, contentType: r.content_type, sizeBytes: r.size_bytes }));
}

/** One document's storage path, only if its invoice belongs to `orgId` — the download route's access check. */
export async function getInvoiceDocument(
  documentId: string,
  invoiceId: string,
  orgId: string,
): Promise<(InvoiceDocument & { filePath: string }) | null> {
  const row = await queryOne<{ id: string; file_name: string; content_type: string; size_bytes: number; file_path: string }>(
    `SELECT d.id, d.file_name, d.content_type, d.size_bytes, d.file_path
       FROM invoice_documents d JOIN invoices i ON i.id = d.invoice_id
      WHERE d.id = $1 AND d.invoice_id = $2 AND i.org_id = $3`,
    [documentId, invoiceId, orgId],
  );
  return row
    ? { id: row.id, fileName: row.file_name, contentType: row.content_type, sizeBytes: row.size_bytes, filePath: row.file_path }
    : null;
}
