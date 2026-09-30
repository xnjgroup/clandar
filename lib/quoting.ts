/**
 * Quoting: analyze a project's photos with the org's default LLM provider,
 * propose a line-itemized estimate, and let a person save and send it. The
 * model's output is always a starting point a person reviews — nothing here
 * sends anything to a customer without an explicit "Send" action.
 */
import { num, query, queryOne, transaction } from "@/lib/db";
import type { ProjectPhoto } from "@/lib/project-photos";
import { readProjectPhotoBytes } from "@/lib/project-photos";
import { chatComplete, quoteLlmProvider, type ChatContentPart } from "@/lib/llm-providers";

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
  projectId: string;
  status: EstimateStatus;
  summary: string;
  subtotal: number;
  tax: number;
  total: number;
  aiGenerated: boolean;
  sentAt: Date | null;
  /** When "Create tasks from quote" ran for this (accepted) estimate. */
  tasksCreatedAt: Date | null;
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

export async function listEstimates(projectId: string): Promise<Estimate[]> {
  const rows = await query<{
    id: string;
    project_id: string;
    status: EstimateStatus;
    summary: string;
    subtotal: string;
    tax: string;
    total: string;
    ai_generated: boolean;
    sent_at: Date | null;
    tasks_created_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, project_id, status, summary, subtotal, tax, total, ai_generated, sent_at, tasks_created_at, created_at
       FROM estimates WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId],
  );
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      projectId: r.project_id,
      status: r.status,
      summary: r.summary,
      subtotal: num(r.subtotal),
      tax: num(r.tax),
      total: num(r.total),
      aiGenerated: r.ai_generated,
      sentAt: r.sent_at,
      tasksCreatedAt: r.tasks_created_at,
      createdAt: r.created_at,
      lineItems: await lineItemsFor(r.id),
    })),
  );
}

export async function getEstimate(id: string, projectId: string): Promise<Estimate | null> {
  const row = await queryOne<{
    id: string;
    project_id: string;
    status: EstimateStatus;
    summary: string;
    subtotal: string;
    tax: string;
    total: string;
    ai_generated: boolean;
    sent_at: Date | null;
    tasks_created_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, project_id, status, summary, subtotal, tax, total, ai_generated, sent_at, tasks_created_at, created_at
       FROM estimates WHERE id = $1 AND project_id = $2`,
    [id, projectId],
  );
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    summary: row.summary,
    subtotal: num(row.subtotal),
    tax: num(row.tax),
    total: num(row.total),
    aiGenerated: row.ai_generated,
    sentAt: row.sent_at,
    tasksCreatedAt: row.tasks_created_at,
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
  projectId: string;
  summary: string;
  lineItems: { description: string; quantity: number; unitPrice: number; kind: LineItemKind }[];
  aiGenerated: boolean;
  createdBy: string | null;
}): Promise<string> {
  const { subtotal, tax, total } = totals(input.lineItems);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO estimates (org_id, project_id, summary, subtotal, tax, total, ai_generated, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [input.orgId, input.projectId, input.summary, subtotal, tax, total, input.aiGenerated, input.createdBy],
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

/**
 * Replaces a draft's summary and line items and recomputes its totals. Only a
 * draft can change — what a customer was sent stays as sent. Returns false
 * when the estimate isn't a draft (or isn't in this org).
 */
export async function updateEstimate(
  id: string,
  orgId: string,
  input: {
    summary: string;
    lineItems: { description: string; quantity: number; unitPrice: number; kind: LineItemKind }[];
  },
): Promise<boolean> {
  const { subtotal, tax, total } = totals(input.lineItems);
  return transaction(async (client) => {
    const updated = await client.query(
      `UPDATE estimates SET summary = $3, subtotal = $4, tax = $5, total = $6
        WHERE id = $1 AND org_id = $2 AND status = 'draft'`,
      [id, orgId, input.summary, subtotal, tax, total],
    );
    if (updated.rowCount === 0) return false;
    await client.query(`DELETE FROM estimate_line_items WHERE estimate_id = $1`, [id]);
    for (const [i, li] of input.lineItems.entries()) {
      await client.query(
        `INSERT INTO estimate_line_items (estimate_id, description, quantity, unit_price, kind, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, li.description, li.quantity, li.unitPrice, li.kind, i],
      );
    }
    return true;
  });
}

/** Records a send: a draft becomes "sent"; a resend only bumps `sent_at`, keeping an accepted/declined answer. */
export async function markEstimateSent(id: string, orgId: string): Promise<void> {
  await query(
    `UPDATE estimates SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = now()
      WHERE id = $1 AND org_id = $2`,
    [id, orgId],
  );
}

export async function setEstimateStatus(id: string, orgId: string, status: EstimateStatus): Promise<void> {
  await query(`UPDATE estimates SET status = $3 WHERE id = $1 AND org_id = $2`, [id, orgId, status]);
}

/** "2 × $45.00" style detail for a checklist step made from a labor/other line. */
function lineDetail(quantity: number, unitPrice: number): string {
  return `${quantity} × $${unitPrice.toFixed(2)}`;
}

/** The part of an item label that identifies it across re-syncs — the description, without a trailing "(2 × $45.00)". */
function itemKey(label: string): string {
  return label.replace(/\s*\([^()]*\)\s*$/, "").trim().toLowerCase();
}

/**
 * Syncs an accepted estimate into the project's work: labor/other lines become
 * the steps of the "Work" to-do, material lines the items (quantity + unit
 * price) of the "Materials" shopping list. Used for the first "Create tasks"
 * and every "Regenerate" after — and when a revised quote is accepted:
 *
 * - the project's existing quote-built tasks are reused (their assignee, due
 *   date, store and notes stay), or created if there are none;
 * - only items that came from a quote are rebuilt; ones added by hand stay;
 * - an item already ticked off stays ticked (matched by description), keeping
 *   its link and unit too.
 *
 * Returns what it did, or null if the estimate isn't an accepted one on this project.
 */
export async function syncTasksFromEstimate(input: {
  estimateId: string;
  projectId: string;
  orgId: string;
  createdBy: string | null;
  timeZone?: string;
}): Promise<{ todoId: string | null; shoppingId: string | null; created: number; updated: number } | null> {
  return transaction(async (client) => {
    const estimate = await client.query<{ title: string }>(
      `SELECT j.title FROM estimates e JOIN projects j ON j.id = e.project_id
        WHERE e.id = $1 AND e.project_id = $2 AND e.org_id = $3 AND e.status = 'accepted'
        FOR UPDATE OF e`,
      [input.estimateId, input.projectId, input.orgId],
    );
    if (estimate.rowCount === 0) return null;
    const projectTitle = estimate.rows[0].title;
    const lines = await client.query<{ description: string; quantity: string; unit_price: string; kind: LineItemKind }>(
      `SELECT description, quantity, unit_price, kind FROM estimate_line_items WHERE estimate_id = $1 ORDER BY sort_order`,
      [input.estimateId],
    );

    let created = 0;
    let updated = 0;
    const sync = async (
      kind: "todo" | "shopping",
      title: string,
      items: { label: string; quantity: number | null; unitPrice: number | null }[],
    ): Promise<string | null> => {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM tasks WHERE project_id = $1 AND org_id = $2 AND kind = $3 AND estimate_id IS NOT NULL
          ORDER BY created_at LIMIT 1 FOR UPDATE`,
        [input.projectId, input.orgId, kind],
      );
      let taskId = existing.rows[0]?.id ?? null;
      if (!taskId && items.length === 0) return null;

      // What the old quote-made items looked like, to carry ticks/links/units over.
      const previous = new Map<string, { is_done: boolean; url: string | null; unit: string }>();
      if (taskId) {
        const old = await client.query<{ label: string; is_done: boolean; url: string | null; unit: string }>(
          `DELETE FROM task_items WHERE task_id = $1 AND from_estimate RETURNING label, is_done, url, unit`,
          [taskId],
        );
        for (const o of old.rows) previous.set(itemKey(o.label), o);
        await client.query(`UPDATE tasks SET estimate_id = $2 WHERE id = $1`, [taskId, input.estimateId]);
        updated++;
      } else {
        taskId = (
          await client.query<{ id: string }>(
            `INSERT INTO tasks (org_id, project_id, kind, title, notes, created_by, time_zone, estimate_id)
             VALUES ($1, $2, $3, $4, 'From the accepted estimate.', $5, $6, $7) RETURNING id`,
            [input.orgId, input.projectId, kind, title, input.createdBy, input.timeZone || "UTC", input.estimateId],
          )
        ).rows[0].id;
        created++;
      }
      for (const item of items) {
        const prior = previous.get(itemKey(item.label));
        await client.query(
          `INSERT INTO task_items (task_id, label, quantity, unit_price, is_done, url, unit, from_estimate)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
          [taskId, item.label, item.quantity, item.unitPrice, prior?.is_done ?? false, prior?.url ?? null, prior?.unit ?? ""],
        );
      }
      return taskId;
    };

    const todoId = await sync(
      "todo",
      `Work: ${projectTitle}`,
      lines.rows
        .filter((l) => l.kind !== "material")
        .map((l) => ({
          label: `${l.description} (${lineDetail(num(l.quantity), num(l.unit_price))})`,
          quantity: null,
          unitPrice: null,
        })),
    );
    const shoppingId = await sync(
      "shopping",
      `Materials: ${projectTitle}`,
      lines.rows
        .filter((l) => l.kind === "material")
        .map((l) => ({ label: l.description, quantity: num(l.quantity), unitPrice: num(l.unit_price) })),
    );
    await client.query(`UPDATE estimates SET tasks_created_at = now() WHERE id = $1`, [input.estimateId]);
    return { todoId, shoppingId, created, updated };
  });
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
 * Sends the project's photos to the org's default LLM provider (a
 * vision-capable model is required — most local multimodal models and every
 * current OpenAI chat model work) and asks for a scope of work and
 * line-itemized estimate. Always a draft a person reviews before saving or
 * sending anything.
 */
export async function analyzeProjectPhotos(
  orgId: string,
  project: { title: string; projectType: string; address: string; notes: string },
  photos: ProjectPhoto[],
): Promise<ProposedEstimate> {
  if (photos.length === 0) throw new Error("Add at least one photo of the project site first.");
  const provider = await quoteLlmProvider(orgId);
  if (!provider) throw new Error("No default LLM provider is configured — set one up on /settings first.");

  const imageParts: ChatContentPart[] = await Promise.all(
    photos.map(async (photo) => {
      const bytes = await readProjectPhotoBytes(photo);
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
          "You are a small business estimator. You are shown photos related to a project and asked to propose a " +
          "line-itemized estimate. Be concrete and realistic about scope, labor hours, and typical US costs for " +
          "the kind of work given. Reply with ONLY JSON, no prose, no markdown fences, in exactly this shape: " +
          '{"summary": "one paragraph describing the scope of work", "lineItems": [{"description": "...", ' +
          '"quantity": 1, "unitPrice": 0, "kind": "labor|material|other"}, ...]}',
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Project: ${project.title}\nType: ${project.projectType}\nAddress: ${project.address}\nNotes: ${project.notes || "(none)"}\n\nPropose an estimate from these photos.`,
          },
          ...imageParts,
        ],
      },
    ],
    { timeoutMs: 120_000, model: provider.quoteModel ?? undefined },
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
