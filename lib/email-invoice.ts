/**
 * Records an invoice/receipt that arrived by email: reads it (the attached
 * PDF/image when there is one, otherwise the email's own text) with the same
 * parser as project uploads (lib/document-ingest.ts), writes the invoice, and
 * keeps the source — the attachment and the original email as .eml — as the
 * invoice's documents. Used by the chat assistant's record_email_invoice tool.
 */
import type { InvoiceStatus } from "@/lib/data";
import { query, queryOne, transaction } from "@/lib/db";
import { emailBodyText } from "@/lib/email-context";
import { insertInvoice, readInvoiceDocument, type InvoiceSource } from "@/lib/document-ingest";
import { readAttachment, readRawMail, type MailDetail } from "@/lib/gmail";
import { deleteUpload, saveUpload } from "@/lib/storage";

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
  /** True when a matching invoice (same vendor, date, amount) already existed and was returned instead. */
  alreadyRecorded?: boolean;
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
    const text = emailBodyText(message);
    source = { fileName: `Email: ${message.subject}`, text: `From: ${message.from} <${message.fromEmail}>\n\n${text}` };
  }

  const data = await readInvoiceDocument(orgId, docType, source);

  // Same vendor, date and amount already on file (e.g. the email was recorded twice): reuse it, don't duplicate.
  const existing = await queryOne<{ id: string; slug: string }>(
    `SELECT i.id, v.slug FROM invoices i JOIN vendors v ON v.id = i.vendor_id
      WHERE i.org_id = $1 AND lower(v.name) = lower($2) AND i.invoice_date = $3 AND i.amount = $4
      ORDER BY i.created_at LIMIT 1`,
    [orgId, data.vendorName, data.invoiceDate, data.total],
  );
  if (existing) {
    return {
      invoiceId: existing.id,
      vendorName: data.vendorName,
      vendorSlug: existing.slug,
      total: data.total,
      invoiceDate: data.invoiceDate,
      dueDate: data.dueDate,
      lineItemCount: data.lineItems.length,
      source: attachment ? attachment.filename : "the email text",
      documents: [],
      alreadyRecorded: true,
    };
  }

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

/**
 * Approves or rejects an invoice (the approval queue). Approving needs every flag cleared first;
 * the approver is recorded. Returns an error message, or null when done.
 */
export async function setInvoiceStatus(
  invoiceId: string,
  orgId: string,
  status: "approved" | "rejected" | "pending_review",
  approverId: string | null,
): Promise<string | null> {
  if (status === "approved") {
    const open = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM invoice_flags f JOIN invoices i ON i.id = f.invoice_id
        WHERE f.invoice_id = $1 AND i.org_id = $2 AND f.cleared_at IS NULL`,
      [invoiceId, orgId],
    );
    if ((open?.n ?? 0) > 0) return "Clear all flags before approving.";
  }
  const updated = await query(
    `UPDATE invoices SET status = $3, approver_id = CASE WHEN $3 = 'approved' THEN $4::uuid ELSE approver_id END
      WHERE id = $1 AND org_id = $2 RETURNING id`,
    [invoiceId, orgId, status, approverId],
  );
  return updated.length ? null : "Invoice not found.";
}

/** Clears one flag on an invoice (it's been checked) — flags must be cleared before approving. */
export async function clearInvoiceFlag(flagId: string, orgId: string): Promise<void> {
  await query(
    `UPDATE invoice_flags f SET cleared_at = now() FROM invoices i
      WHERE f.id = $1 AND i.id = f.invoice_id AND i.org_id = $2 AND f.cleared_at IS NULL`,
    [flagId, orgId],
  );
}

/**
 * Deletes an invoice: its line items, flags and source documents go with it
 * (FK cascade), and the documents' stored bytes are removed too. A project
 * file it was parsed from stays, reset so it can be read again.
 */
export async function deleteInvoice(invoiceId: string, orgId: string): Promise<boolean> {
  const docs = await query<{ file_path: string }>(
    `SELECT d.file_path FROM invoice_documents d JOIN invoices i ON i.id = d.invoice_id
      WHERE d.invoice_id = $1 AND i.org_id = $2`,
    [invoiceId, orgId],
  );
  const deleted = await transaction(async (client) => {
    await client.query(
      `UPDATE project_files f SET parse_status = NULL, parse_error = NULL
         FROM invoices i WHERE f.invoice_id = i.id AND i.id = $1 AND i.org_id = $2`,
      [invoiceId, orgId],
    );
    const result = await client.query(`DELETE FROM invoices WHERE id = $1 AND org_id = $2`, [invoiceId, orgId]);
    return (result.rowCount ?? 0) > 0;
  });
  if (deleted) for (const d of docs) await deleteUpload(d.file_path).catch(() => {});
  return deleted;
}

export type ProjectInvoice = {
  id: string;
  vendor: string;
  vendorSlug: string;
  category: string;
  date: string;
  dueDate: string | null;
  amount: number;
  status: InvoiceStatus;
};

/** The invoices/receipts charged to a project, newest first — for the project page. */
export async function listProjectInvoices(projectId: string, orgId: string): Promise<ProjectInvoice[]> {
  const rows = await query<{
    id: string;
    vendor: string;
    slug: string;
    category: string;
    invoice_date: string;
    due_date: string | null;
    amount: string;
    status: InvoiceStatus;
  }>(
    `SELECT i.id, v.name AS vendor, v.slug, i.category, i.invoice_date::text, i.due_date::text, i.amount::text, i.status
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id
      WHERE i.project_id = $1 AND i.org_id = $2
      ORDER BY i.invoice_date DESC, i.created_at DESC`,
    [projectId, orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    vendor: r.vendor,
    vendorSlug: r.slug,
    category: r.category,
    date: r.invoice_date,
    dueDate: r.due_date,
    amount: Number(r.amount),
    status: r.status,
  }));
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
