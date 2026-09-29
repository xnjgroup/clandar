/**
 * Quoting: analyze a job's photos with the org's default LLM provider,
 * propose a line-itemized estimate, and let a person save and send it. The
 * model's output is always a starting point a person reviews — nothing here
 * sends anything to a customer without an explicit "Send" action.
 */
import { num, query, queryOne } from "@/lib/db";
import type { JobPhoto } from "@/lib/job-photos";
import { readJobPhotoBytes } from "@/lib/job-photos";
import { chatComplete, defaultLlmProvider, type ChatContentPart } from "@/lib/llm-providers";

export type LineItemKind = "labor" | "material" | "other";

export type EstimateLineItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  kind: LineItemKind;
};

export type EstimateStatus = "draft" | "sent" | "accepted" | "declined";

export type Estimate = {
  id: string;
  jobId: string;
  status: EstimateStatus;
  summary: string;
  subtotal: number;
  tax: number;
  total: number;
  aiGenerated: boolean;
  sentAt: Date | null;
  createdAt: Date;
  lineItems: EstimateLineItem[];
};

async function lineItemsFor(estimateId: string): Promise<EstimateLineItem[]> {
  const rows = await query<{
    id: string;
    description: string;
    quantity: string;
    unit_price: string;
    kind: LineItemKind;
  }>(
    `SELECT id, description, quantity, unit_price, kind FROM estimate_line_items
      WHERE estimate_id = $1 ORDER BY sort_order`,
    [estimateId],
  );
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    quantity: num(r.quantity),
    unitPrice: num(r.unit_price),
    kind: r.kind,
  }));
}

export async function listEstimates(jobId: string): Promise<Estimate[]> {
  const rows = await query<{
    id: string;
    job_id: string;
    status: EstimateStatus;
    summary: string;
    subtotal: string;
    tax: string;
    total: string;
    ai_generated: boolean;
    sent_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, job_id, status, summary, subtotal, tax, total, ai_generated, sent_at, created_at
       FROM estimates WHERE job_id = $1 ORDER BY created_at DESC`,
    [jobId],
  );
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      jobId: r.job_id,
      status: r.status,
      summary: r.summary,
      subtotal: num(r.subtotal),
      tax: num(r.tax),
      total: num(r.total),
      aiGenerated: r.ai_generated,
      sentAt: r.sent_at,
      createdAt: r.created_at,
      lineItems: await lineItemsFor(r.id),
    })),
  );
}

export async function getEstimate(id: string, jobId: string): Promise<Estimate | null> {
  const row = await queryOne<{
    id: string;
    job_id: string;
    status: EstimateStatus;
    summary: string;
    subtotal: string;
    tax: string;
    total: string;
    ai_generated: boolean;
    sent_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, job_id, status, summary, subtotal, tax, total, ai_generated, sent_at, created_at
       FROM estimates WHERE id = $1 AND job_id = $2`,
    [id, jobId],
  );
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    summary: row.summary,
    subtotal: num(row.subtotal),
    tax: num(row.tax),
    total: num(row.total),
    aiGenerated: row.ai_generated,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    lineItems: await lineItemsFor(row.id),
  };
}

const TAX_RATE = 0; // sales tax on labor/materials varies too much by jurisdiction to guess — left at 0, editable per line item's total if a rate applies

function totals(lineItems: { quantity: number; unitPrice: number }[]) {
  const subtotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
  const tax = subtotal * TAX_RATE;
  return { subtotal, tax, total: subtotal + tax };
}

export async function createEstimate(input: {
  orgId: string;
  jobId: string;
  summary: string;
  lineItems: { description: string; quantity: number; unitPrice: number; kind: LineItemKind }[];
  aiGenerated: boolean;
  createdBy: string | null;
}): Promise<string> {
  const { subtotal, tax, total } = totals(input.lineItems);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO estimates (org_id, job_id, summary, subtotal, tax, total, ai_generated, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [input.orgId, input.jobId, input.summary, subtotal, tax, total, input.aiGenerated, input.createdBy],
  );
  const estimateId = row!.id;
  let sortOrder = 0;
  for (const li of input.lineItems) {
    await query(
      `INSERT INTO estimate_line_items (estimate_id, description, quantity, unit_price, kind, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [estimateId, li.description, li.quantity, li.unitPrice, li.kind, sortOrder++],
    );
  }
  return estimateId;
}

export async function markEstimateSent(id: string, orgId: string): Promise<void> {
  await query(
    `UPDATE estimates SET status = 'sent', sent_at = now() WHERE id = $1 AND org_id = $2`,
    [id, orgId],
  );
}

export async function setEstimateStatus(id: string, orgId: string, status: EstimateStatus): Promise<void> {
  await query(`UPDATE estimates SET status = $3 WHERE id = $1 AND org_id = $2`, [id, orgId, status]);
}

export async function deleteEstimate(id: string, orgId: string): Promise<void> {
  await query(`DELETE FROM estimates WHERE id = $1 AND org_id = $2`, [id, orgId]);
}

/* ── AI photo analysis ────────────────────────────────────── */

export type ProposedLineItem = { description: string; quantity: number; unitPrice: number; kind: LineItemKind };
export type ProposedEstimate = { summary: string; lineItems: ProposedLineItem[] };

function extToMime(path: string, fallback: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return fallback;
}

/**
 * Sends the job's photos to the org's default LLM provider (a vision-capable
 * model is required — most local multimodal models and every current OpenAI
 * chat model work) and asks for a scope of work and line-itemized estimate.
 * Always a draft a person reviews before saving or sending anything.
 */
export async function analyzeJobPhotos(
  orgId: string,
  job: { title: string; trade: string; address: string; notes: string },
  photos: JobPhoto[],
): Promise<ProposedEstimate> {
  if (photos.length === 0) throw new Error("Add at least one photo of the job site first.");
  const provider = await defaultLlmProvider(orgId);
  if (!provider) throw new Error("No default LLM provider is configured — set one up on /settings first.");

  const imageParts: ChatContentPart[] = await Promise.all(
    photos.map(async (photo) => {
      const bytes = await readJobPhotoBytes(photo);
      const mime = photo.contentType || extToMime(photo.filePath, "image/jpeg");
      return {
        type: "image_url" as const,
        image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` },
      };
    }),
  );

  const raw = await chatComplete(
    provider.id,
    [
      {
        role: "system",
        content:
          "You are a home improvement estimator. You are shown photos of a job site and asked to propose a " +
          "line-itemized estimate. Be concrete and realistic about scope, labor hours, and typical US material " +
          "costs for the trade given. Reply with ONLY JSON, no prose, no markdown fences, in exactly this shape: " +
          '{"summary": "one paragraph describing the scope of work", "lineItems": [{"description": "...", ' +
          '"quantity": 1, "unitPrice": 0, "kind": "labor|material|other"}, ...]}',
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Job: ${job.title}\nTrade: ${job.trade}\nAddress: ${job.address}\nNotes: ${job.notes || "(none)"}\n\nPropose an estimate from these photos.`,
          },
          ...imageParts,
        ],
      },
    ],
    { timeoutMs: 120_000 },
  );

  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) throw new Error(`${provider.name} did not return JSON — try again, or check it supports image input.`);
  const parsed = JSON.parse(match[0]) as {
    summary?: string;
    lineItems?: { description?: string; quantity?: number; unitPrice?: number; kind?: string }[];
  };
  const lineItems: ProposedLineItem[] = (parsed.lineItems ?? [])
    .filter((li) => li.description)
    .map((li) => ({
      description: String(li.description).slice(0, 300),
      quantity: Number(li.quantity) > 0 ? Number(li.quantity) : 1,
      unitPrice: Number(li.unitPrice) >= 0 ? Number(li.unitPrice) : 0,
      kind: li.kind === "material" || li.kind === "other" ? li.kind : "labor",
    }));
  if (lineItems.length === 0) throw new Error(`${provider.name} did not propose any line items — try again.`);

  return { summary: String(parsed.summary ?? "").slice(0, 2000), lineItems };
}

/** Plain-text estimate body for the "Send to customer" email. */
export function formatEstimateEmail(job: { title: string }, estimate: Estimate): { subject: string; body: string } {
  const lines = estimate.lineItems.map(
    (li) => `  - ${li.description}  (${li.quantity} x $${li.unitPrice.toFixed(2)} = $${(li.quantity * li.unitPrice).toFixed(2)})`,
  );
  const body = [
    estimate.summary,
    "",
    "Estimate:",
    ...lines,
    "",
    `Subtotal: $${estimate.subtotal.toFixed(2)}`,
    estimate.tax > 0 ? `Tax: $${estimate.tax.toFixed(2)}` : null,
    `Total: $${estimate.total.toFixed(2)}`,
    "",
    "Reply to this email with any questions or to schedule the work.",
  ]
    .filter((l) => l !== null)
    .join("\n");
  return { subject: `Estimate for ${job.title}`, body };
}
