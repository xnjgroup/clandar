/**
 * Turns a project file uploaded as an invoice or receipt into an `invoices`
 * row (tied to the project) plus its charges as `invoice_line_items`: text is
 * pulled out with lib/document-extract.ts (images go to the model directly),
 * the org's default LLM provider reads it into a fixed JSON shape, and the
 * result lands as `pending_review` so a person checks it before it counts as
 * approved spend.
 *
 * Progress lives on the file row (`parse_status` / `parse_error` /
 * `invoice_id`) so the project page can show it — callers run this after the
 * upload response (next/server `after`), never inline.
 */
import type { PoolClient } from "pg";
import { query, queryOne, transaction } from "@/lib/db";
import { extractDocumentText } from "@/lib/document-extract";
import type { DocType } from "@/lib/doc-types";
import { chatComplete, defaultLlmProvider, type ChatContentPart } from "@/lib/llm-providers";
import { getProjectFile, readProjectFileBytes } from "@/lib/project-photos";


/** What the model may file spend under; a pick outside this list becomes "Other". Created in `categories` on first use. */
const SPEND_CATEGORIES = [
  "Materials",
  "Tools & equipment",
  "Subcontractors",
  "Permits & fees",
  "Fuel & travel",
  "Utilities",
  "Software & services",
  "Office & admin",
  "Other",
];

const LINE_KINDS = ["one-time", "recurring", "tax", "credit"] as const;
type LineKind = (typeof LINE_KINDS)[number];

type Extracted = {
  vendorName: string;
  invoiceDate: string;
  dueDate: string | null;
  accountNumber: string | null;
  paymentMethod: string | null;
  category: string;
  total: number;
  lineItems: { description: string; amount: number; kind: LineKind }[];
};

function instructions(docType: "invoice" | "receipt"): string {
  return [
    `You read a ${docType === "invoice" ? "supplier invoice or bill" : "purchase receipt"} and extract its data.`,
    "Reply with ONLY one JSON object, no prose and no code fence, in exactly this shape:",
    "{",
    '  "vendorName": "who issued it — the business, not the customer",',
    '  "invoiceDate": "YYYY-MM-DD",',
    '  "dueDate": "YYYY-MM-DD or null",',
    '  "accountNumber": "string or null",',
    '  "paymentMethod": "e.g. Visa ending 4242, cash — or null",',
    `  "category": "one of: ${SPEND_CATEGORIES.join(", ")}",`,
    '  "total": number (the grand total actually charged, tax included),',
    '  "lineItems": [{ "description": "string", "amount": number, "kind": "one-time | recurring | tax | credit" }]',
    "}",
    "Amounts are plain numbers without currency symbols; a credit or discount is negative.",
    "List tax as its own line item with kind \"tax\". If the document has no itemized lines, return one line for the total.",
  ].join("\n");
}

const isoDate = (value: unknown): string | null =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
const text = (value: unknown, max = 200): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
const amount = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[^0-9.-]/g, "")) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/** Pulls the first JSON object out of the reply (models sometimes wrap it in prose or a fence) and validates it. */
function parseReply(reply: string): Extracted {
  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The model didn't return any JSON.");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new Error("The model returned malformed JSON.");
  }

  const vendorName = text(raw.vendorName, 120);
  if (!vendorName) throw new Error("Couldn't tell who issued the document.");
  const lineItems = (Array.isArray(raw.lineItems) ? raw.lineItems : [])
    .map((item) => {
      const i = (item ?? {}) as Record<string, unknown>;
      const value = amount(i.amount);
      if (value === null) return null;
      const kind = LINE_KINDS.includes(i.kind as LineKind) ? (i.kind as LineKind) : "one-time";
      return { description: text(i.description, 300) ?? "Charge", amount: value, kind };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null);
  const total = amount(raw.total) ?? lineItems.reduce((sum, i) => sum + i.amount, 0);
  if (!total && lineItems.length === 0) throw new Error("Couldn't find any amounts.");

  const category = SPEND_CATEGORIES.find((c) => c.toLowerCase() === String(raw.category ?? "").toLowerCase()) ?? "Other";
  return {
    vendorName,
    invoiceDate: isoDate(raw.invoiceDate) ?? new Date().toISOString().slice(0, 10),
    dueDate: isoDate(raw.dueDate),
    accountNumber: text(raw.accountNumber, 80),
    paymentMethod: text(raw.paymentMethod, 80),
    category,
    total,
    lineItems: lineItems.length > 0 ? lineItems : [{ description: "Total", amount: total, kind: "one-time" }],
  };
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "vendor";
}

/** The org's vendor with this name (case-insensitive), created with a free slug if it's new. */
async function findOrCreateVendor(client: PoolClient, orgId: string, name: string, category: string): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM vendors WHERE org_id = $1 AND lower(name) = lower($2)`,
    [orgId, name],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const base = slugify(name);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO vendors (org_id, name, slug, category) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING id`,
      [orgId, name, slug, category],
    );
    if (inserted.rows[0]) return inserted.rows[0].id;
  }
}

async function setStatus(fileId: string, status: "pending" | "done" | "failed", error: string | null = null) {
  await query(`UPDATE project_files SET parse_status = $2, parse_error = $3 WHERE id = $1`, [fileId, status, error]);
}

/** Marks the file as queued for parsing — call before scheduling `parseProjectDocument` so the page shows it at once. */
export async function markParsePending(fileId: string): Promise<void> {
  await setStatus(fileId, "pending");
}

/**
 * Reads an invoice/receipt file and records it as an invoice on the project.
 * Never throws — any failure is written to the file's `parse_error` instead.
 */
export async function parseProjectDocument(fileId: string, projectId: string, orgId: string): Promise<void> {
  try {
    const file = await getProjectFile(fileId, projectId);
    if (!file) return;
    const doc = await queryOne<{ doc_type: DocType }>(`SELECT doc_type FROM project_files WHERE id = $1`, [fileId]);
    if (!doc || doc.doc_type === "general") return;
    const docType = doc.doc_type;

    const provider = await defaultLlmProvider(orgId);
    if (!provider) throw new Error("No AI provider is set up — add one on Settings first.");

    const bytes = await readProjectFileBytes(file);
    let content: ChatContentPart[];
    if (file.contentType.startsWith("image/")) {
      content = [
        { type: "text", text: `The ${docType} is in this image (${file.fileName}).` },
        { type: "image_url", image_url: { url: `data:${file.contentType};base64,${bytes.toString("base64")}` } },
      ];
    } else {
      const extracted = await extractDocumentText(file.fileName, file.contentType, bytes);
      if ("error" in extracted) throw new Error(extracted.error);
      if (!extracted.text.trim()) throw new Error("The file has no readable text — if it's a scan, upload it as an image.");
      content = [{ type: "text", text: `${file.fileName}:\n\n${extracted.text}` }];
    }

    const reply = await chatComplete(
      provider.id,
      [
        { role: "system", content: instructions(docType) },
        { role: "user", content },
      ],
      { temperature: 0, timeoutMs: 100_000 },
    );
    const data = parseReply(reply);

    await transaction(async (client) => {
      await client.query(`INSERT INTO categories (name) VALUES ($1) ON CONFLICT DO NOTHING`, [data.category]);
      const vendorId = await findOrCreateVendor(client, orgId, data.vendorName, data.category);
      const invoice = await client.query<{ id: string }>(
        `INSERT INTO invoices (org_id, vendor_id, category, project_id, invoice_date, amount, status,
                               account_number, due_date, payment_method, submitted_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending_review', $7, $8, $9, $10) RETURNING id`,
        [
          orgId,
          vendorId,
          data.category,
          projectId,
          data.invoiceDate,
          data.total,
          data.accountNumber,
          data.dueDate,
          data.paymentMethod ?? (docType === "receipt" ? "Paid (receipt)" : null),
          `Parsed from ${docType} ${file.fileName}`.slice(0, 200),
        ],
      );
      const invoiceId = invoice.rows[0].id;
      for (const [i, line] of data.lineItems.entries()) {
        await client.query(
          `INSERT INTO invoice_line_items (invoice_id, group_label, tag, description, amount, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [invoiceId, data.vendorName, line.kind, line.description, line.amount, i],
        );
      }
      await client.query(
        `UPDATE project_files SET invoice_id = $2, parse_status = 'done', parse_error = NULL WHERE id = $1`,
        [fileId, invoiceId],
      );
    });
  } catch (error) {
    await setStatus(fileId, "failed", (error instanceof Error ? error.message : String(error)).slice(0, 500)).catch(
      () => {},
    );
  }
}
