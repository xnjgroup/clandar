/**
 * Every read the pages make. Each function returns a shape the UI can render
 * directly; no page talks to `pg` itself.
 *
 * `date` columns are cast to text so they arrive as plain `YYYY-MM-DD` strings
 * instead of Dates in the server's timezone. `numeric` columns come back as
 * strings from node-postgres and are converted with `num()`.
 */
import { cache } from "react";
import { num, query, queryOne } from "@/lib/db";
import type { InvoiceStatus } from "@/lib/data";

/** Counts the sidebar badges show, kept small because every page renders it. */
export const navCounts = cache(async () => {
  const row = await queryOne<{ fraud: string; approvals: string }>(
    `SELECT (SELECT count(*) FROM fraud_flags WHERE status IN ('open', 'investigating')) AS fraud,
            (SELECT count(*) FROM invoices WHERE status IN ('pending_review', 'flagged')) AS approvals`,
  );
  return { "/fraud": num(row?.fraud), "/approvals": num(row?.approvals) } as Record<string, number>;
});

export const categoryNames = cache(async () => {
  const rows = await query<{ name: string }>(
    `SELECT name FROM categories ORDER BY sort_order, name`,
  );
  return rows.map((r) => r.name);
});

/* ── Overview ─────────────────────────────────────────────── */

export type OverviewStats = {
  monthTotal: number;
  monthInvoices: number;
  lastMonthTotal: number;
  pendingTotal: number;
  pendingCount: number;
  flaggedCount: number;
  openFraudCount: number;
  recurringTotal: number;
  recurringVendors: number;
};

export async function overviewStats(): Promise<OverviewStats> {
  const row = await queryOne<Record<string, string>>(
    `WITH this_month AS (
       SELECT coalesce(sum(amount), 0) AS total, count(*) AS invoices
         FROM invoices
        WHERE invoice_date >= date_trunc('month', current_date)
          AND status <> 'rejected'
     ),
     last_month AS (
       SELECT coalesce(sum(amount), 0) AS total
         FROM invoices
        WHERE invoice_date >= date_trunc('month', current_date) - interval '1 month'
          AND invoice_date <  date_trunc('month', current_date)
          AND status <> 'rejected'
     ),
     pending AS (
       SELECT coalesce(sum(amount), 0) AS total, count(*) AS invoices
         FROM invoices WHERE status IN ('pending_review', 'flagged')
     ),
     flagged AS (SELECT count(*) AS invoices FROM invoices WHERE status = 'flagged'),
     fraud AS (SELECT count(*) AS open FROM fraud_flags WHERE status = 'open'),
     recurring AS (
       SELECT coalesce(sum(amount), 0) AS total, count(DISTINCT vendor_id) AS vendors
         FROM recurring_charges
     )
     SELECT this_month.total     AS month_total,
            this_month.invoices  AS month_invoices,
            last_month.total     AS last_month_total,
            pending.total        AS pending_total,
            pending.invoices     AS pending_count,
            flagged.invoices     AS flagged_count,
            fraud.open           AS open_fraud_count,
            recurring.total      AS recurring_total,
            recurring.vendors    AS recurring_vendors
       FROM this_month, last_month, pending, flagged, fraud, recurring`,
  );

  return {
    monthTotal: num(row?.month_total),
    monthInvoices: num(row?.month_invoices),
    lastMonthTotal: num(row?.last_month_total),
    pendingTotal: num(row?.pending_total),
    pendingCount: num(row?.pending_count),
    flaggedCount: num(row?.flagged_count),
    openFraudCount: num(row?.open_fraud_count),
    recurringTotal: num(row?.recurring_total),
    recurringVendors: num(row?.recurring_vendors),
  };
}

export type CategorySlice = { name: string; total: number };

export async function spendByCategory(): Promise<CategorySlice[]> {
  const rows = await query<{ name: string; total: string }>(
    `SELECT c.name, coalesce(sum(i.amount), 0) AS total
       FROM categories c
       LEFT JOIN invoices i
              ON i.category = c.name
             AND i.invoice_date >= date_trunc('month', current_date)
             AND i.status <> 'rejected'
      GROUP BY c.name, c.sort_order
      ORDER BY c.sort_order`,
  );
  return rows.map((r) => ({ name: r.name, total: num(r.total) }));
}

export type AttentionItem = {
  title: string;
  note: string;
  severity: "high" | "med";
  icon: "alert" | "clock" | "check2";
  href: string;
};

/** Open risk flags first, then whatever is sitting in the review and approval queues. */
export async function needsAttention(): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];

  const risks = await query<{
    id: string;
    title: string;
    note: string;
    severity: "high" | "med" | "low";
    exposure: string;
    invoice_id: string | null;
    slug: string | null;
  }>(
    `SELECT f.id, f.title, f.note, f.severity, f.exposure, f.invoice_id, v.slug
       FROM fraud_flags f
       LEFT JOIN invoices i ON i.id = f.invoice_id
       LEFT JOIN vendors v ON v.id = i.vendor_id
      WHERE f.status IN ('open', 'investigating')
      ORDER BY CASE f.severity WHEN 'high' THEN 0 WHEN 'med' THEN 1 ELSE 2 END, f.opened_at DESC
      LIMIT 2`,
  );

  for (const risk of risks) {
    items.push({
      title: risk.title,
      note: risk.note,
      severity: risk.severity === "high" ? "high" : "med",
      icon: "alert",
      href: risk.slug && risk.invoice_id ? `/invoices/${risk.slug}?id=${risk.invoice_id}` : "/fraud",
    });
  }

  const review = await queryOne<{ invoices: string; confidence: string | null; vendor: string | null }>(
    `SELECT count(*) AS invoices,
            min(i.ocr_confidence) AS confidence,
            (SELECT v.name FROM invoices j JOIN vendors v ON v.id = j.vendor_id
              WHERE j.status = 'pending_review'
              ORDER BY j.ocr_confidence NULLS LAST LIMIT 1) AS vendor
       FROM invoices i WHERE i.status = 'pending_review'`,
  );

  if (num(review?.invoices) > 0) {
    const confidence = review?.confidence ? Math.round(num(review.confidence) * 100) : null;
    items.push({
      title: `${review?.vendor ?? "An invoice"} awaiting review`,
      note:
        confidence !== null
          ? `${num(review?.invoices)} in the queue — lowest OCR confidence ${confidence}%`
          : `${num(review?.invoices)} in the review queue`,
      severity: "med",
      icon: "clock",
      href: "/invoices?status=Pending",
    });
  }

  const approvals = await queryOne<{ invoices: string; total: string; oldest_days: string | null }>(
    `SELECT count(*) AS invoices, coalesce(sum(amount), 0) AS total,
            max(current_date - invoice_date) AS oldest_days
       FROM invoices WHERE status IN ('pending_review', 'flagged')`,
  );

  if (num(approvals?.invoices) > 0) {
    const days = num(approvals?.oldest_days);
    items.push({
      title: `${num(approvals?.invoices)} invoices pending approval`,
      note: `$${num(approvals?.total).toLocaleString("en-US", { minimumFractionDigits: 2 })} total, oldest submitted ${days} day${days === 1 ? "" : "s"} ago`,
      severity: "med",
      icon: "check2",
      href: "/approvals",
    });
  }

  return items.slice(0, 3);
}

/** The newest thing the expense agent said, for the overview teaser. */
export async function latestAgentLine() {
  const row = await queryOne<{ body: string }>(
    `SELECT body FROM agent_messages WHERE role = 'assistant' ORDER BY created_at DESC LIMIT 1`,
  );
  return row?.body ?? null;
}

/* ── Invoices ─────────────────────────────────────────────── */

export type InvoiceListRow = {
  id: string;
  vendor: string;
  slug: string;
  category: string;
  date: string;
  amount: number;
  status: InvoiceStatus;
  pageCount: number;
};

export const INVOICE_STATUS_TABS = ["All", "Flagged", "Pending", "Approved"] as const;
export type InvoiceStatusTab = (typeof INVOICE_STATUS_TABS)[number];

const TAB_STATUSES: Record<InvoiceStatusTab, InvoiceStatus[] | null> = {
  All: null,
  Flagged: ["flagged"],
  Pending: ["pending_review"],
  Approved: ["approved"],
};

export async function listInvoices(options: {
  tab: InvoiceStatusTab;
  search: string;
  page: number;
  size: number;
}): Promise<{ rows: InvoiceListRow[]; total: number }> {
  const statuses = TAB_STATUSES[options.tab];
  const rows = await query<{
    id: string;
    vendor: string;
    slug: string;
    category: string;
    invoice_date: string;
    amount: string;
    status: InvoiceStatus;
    page_count: number;
    total: string;
  }>(
    `SELECT i.id, v.name AS vendor, v.slug, i.category, i.invoice_date::text,
            i.amount, i.status, i.page_count, count(*) OVER () AS total
       FROM invoices i
       JOIN vendors v ON v.id = i.vendor_id
      WHERE ($1::text[] IS NULL OR i.status = ANY ($1))
        AND ($2 = '' OR v.name ILIKE '%' || $2 || '%'
                     OR i.account_number ILIKE '%' || $2 || '%'
                     OR i.category ILIKE '%' || $2 || '%'
                     OR i.amount::text LIKE $2 || '%')
      ORDER BY i.invoice_date DESC, i.created_at DESC
      LIMIT $3 OFFSET $4`,
    [statuses, options.search, options.size, options.page * options.size],
  );

  return {
    total: rows.length > 0 ? num(rows[0].total) : 0,
    rows: rows.map((r) => ({
      id: r.id,
      vendor: r.vendor,
      slug: r.slug,
      category: r.category,
      date: r.invoice_date,
      amount: num(r.amount),
      status: r.status,
      pageCount: r.page_count,
    })),
  };
}

export async function recentInvoices(limit = 5): Promise<InvoiceListRow[]> {
  const rows = await query<{
    id: string;
    vendor: string;
    slug: string;
    category: string;
    invoice_date: string;
    amount: string;
    status: InvoiceStatus;
    page_count: number;
  }>(
    `SELECT i.id, v.name AS vendor, v.slug, i.category, i.invoice_date::text,
            i.amount, i.status, i.page_count
       FROM invoices i
       JOIN vendors v ON v.id = i.vendor_id
      ORDER BY i.invoice_date DESC, i.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    vendor: r.vendor,
    slug: r.slug,
    category: r.category,
    date: r.invoice_date,
    amount: num(r.amount),
    status: r.status,
    pageCount: r.page_count,
  }));
}

export type InvoiceDetail = {
  id: string;
  vendor: string;
  slug: string;
  category: string;
  status: InvoiceStatus;
  date: string;
  amount: number;
  confidence: number | null;
  account: string | null;
  location: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  paymentMethod: string | null;
  priorBalance: number;
  submittedBy: string;
  approver: string | null;
  lineItemCount: number;
  nextDue: string | null;
  groups: {
    label: string;
    identifier: string | null;
    icon: string;
    lines: { tag: string; description: string; amount: number }[];
  }[];
  flags: { id: string; label: string }[];
};

/**
 * The invoice behind `/invoices/<vendor-slug>`. `id` pins a specific document;
 * without it the vendor's most recent invoice is shown.
 */
export async function invoiceDetail(slug: string, id?: string): Promise<InvoiceDetail | null> {
  const invoice = await queryOne<{
    id: string;
    vendor: string;
    slug: string;
    category: string;
    status: InvoiceStatus;
    invoice_date: string;
    amount: string;
    ocr_confidence: string | null;
    account_number: string | null;
    location: string | null;
    period_start: string | null;
    period_end: string | null;
    due_date: string | null;
    payment_method: string | null;
    prior_balance: string;
    submitted_by: string;
    approver: string | null;
    next_due: string | null;
  }>(
    `SELECT i.id, v.name AS vendor, v.slug, i.category, i.status, i.invoice_date::text,
            i.amount, i.ocr_confidence, i.account_number,
            l.address AS location,
            i.period_start::text, i.period_end::text, i.due_date::text,
            i.payment_method, i.prior_balance, i.submitted_by,
            p.name AS approver,
            (SELECT r.next_due::text FROM recurring_charges r WHERE r.vendor_id = i.vendor_id) AS next_due
       FROM invoices i
       JOIN vendors v ON v.id = i.vendor_id
       LEFT JOIN locations l ON l.id = i.location_id
       LEFT JOIN people p ON p.id = i.approver_id
      WHERE v.slug = $1 AND ($2::uuid IS NULL OR i.id = $2::uuid)
      ORDER BY i.invoice_date DESC
      LIMIT 1`,
    [slug, id ?? null],
  );
  if (!invoice) return null;

  const lines = await query<{
    group_label: string;
    group_identifier: string | null;
    group_icon: string;
    tag: string;
    description: string;
    amount: string;
  }>(
    `SELECT group_label, group_identifier, group_icon, tag, description, amount
       FROM invoice_line_items WHERE invoice_id = $1 ORDER BY sort_order, id`,
    [invoice.id],
  );

  const groups: InvoiceDetail["groups"] = [];
  for (const line of lines) {
    const last = groups.at(-1);
    if (last && last.label === line.group_label) {
      last.lines.push({ tag: line.tag, description: line.description, amount: num(line.amount) });
      continue;
    }
    groups.push({
      label: line.group_label,
      identifier: line.group_identifier,
      icon: line.group_icon,
      lines: [{ tag: line.tag, description: line.description, amount: num(line.amount) }],
    });
  }

  const flags = await query<{ id: string; label: string }>(
    `SELECT id, label FROM invoice_flags
      WHERE invoice_id = $1 AND cleared_at IS NULL ORDER BY created_at`,
    [invoice.id],
  );

  return {
    id: invoice.id,
    vendor: invoice.vendor,
    slug: invoice.slug,
    category: invoice.category,
    status: invoice.status,
    date: invoice.invoice_date,
    amount: num(invoice.amount),
    confidence: invoice.ocr_confidence === null ? null : num(invoice.ocr_confidence),
    account: invoice.account_number,
    location: invoice.location,
    periodStart: invoice.period_start,
    periodEnd: invoice.period_end,
    dueDate: invoice.due_date,
    paymentMethod: invoice.payment_method,
    priorBalance: num(invoice.prior_balance),
    submittedBy: invoice.submitted_by,
    approver: invoice.approver,
    lineItemCount: lines.length,
    nextDue: invoice.next_due,
    groups,
    flags,
  };
}

/* ── Expenses ─────────────────────────────────────────────── */

export type VendorSpendRow = {
  vendor: string;
  category: string;
  thisMonth: number;
  lastMonth: number;
};

export async function vendorSpend(): Promise<VendorSpendRow[]> {
  const rows = await query<{
    vendor: string;
    category: string;
    this_month: string;
    last_month: string;
  }>(
    `SELECT v.name AS vendor, v.category,
            coalesce(sum(i.amount) FILTER (
              WHERE i.invoice_date >= date_trunc('month', current_date)), 0) AS this_month,
            coalesce(sum(i.amount) FILTER (
              WHERE i.invoice_date >= date_trunc('month', current_date) - interval '1 month'
                AND i.invoice_date <  date_trunc('month', current_date)), 0) AS last_month
       FROM vendors v
       LEFT JOIN invoices i
              ON i.vendor_id = v.id
             AND i.status <> 'rejected'
             AND i.invoice_date >= date_trunc('month', current_date) - interval '1 month'
      GROUP BY v.name, v.category
     HAVING coalesce(sum(i.amount), 0) > 0
      ORDER BY this_month DESC, v.name`,
  );
  return rows.map((r) => ({
    vendor: r.vendor,
    category: r.category,
    thisMonth: num(r.this_month),
    lastMonth: num(r.last_month),
  }));
}

export type CategorySpendRow = {
  category: string;
  vendors: number;
  thisMonth: number;
  lastMonth: number;
};

export async function categorySpend(): Promise<CategorySpendRow[]> {
  const rows = await query<{
    category: string;
    vendors: string;
    this_month: string;
    last_month: string;
  }>(
    `SELECT i.category,
            count(DISTINCT i.vendor_id) AS vendors,
            coalesce(sum(i.amount) FILTER (
              WHERE i.invoice_date >= date_trunc('month', current_date)), 0) AS this_month,
            coalesce(sum(i.amount) FILTER (
              WHERE i.invoice_date >= date_trunc('month', current_date) - interval '1 month'
                AND i.invoice_date <  date_trunc('month', current_date)), 0) AS last_month
       FROM invoices i
      WHERE i.status <> 'rejected'
        AND i.invoice_date >= date_trunc('month', current_date) - interval '1 month'
      GROUP BY i.category
      ORDER BY this_month DESC`,
  );
  return rows.map((r) => ({
    category: r.category,
    vendors: num(r.vendors),
    thisMonth: num(r.this_month),
    lastMonth: num(r.last_month),
  }));
}

export type MonthSpendRow = { month: string; total: number; invoices: number };

export async function monthlySpend(months = 6): Promise<MonthSpendRow[]> {
  const rows = await query<{ month: string; total: string; invoices: string }>(
    `SELECT to_char(date_trunc('month', invoice_date), 'Mon YYYY') AS month,
            sum(amount) AS total, count(*) AS invoices
       FROM invoices
      WHERE status <> 'rejected'
        AND invoice_date >= date_trunc('month', current_date) - make_interval(months => $1::int - 1)
      GROUP BY date_trunc('month', invoice_date)
      ORDER BY date_trunc('month', invoice_date)`,
    [months],
  );
  return rows.map((r) => ({ month: r.month, total: num(r.total), invoices: num(r.invoices) }));
}

/* ── Recurring ────────────────────────────────────────────── */

export type RecurringStats = {
  subscriptions: number;
  monthlyTotal: number;
  dueSoon: number;
  dueSoonTotal: number;
  increases: number;
  avgIncreasePct: number;
};

export async function recurringStats(): Promise<RecurringStats> {
  const row = await queryOne<Record<string, string | null>>(
    `WITH totals AS (
       SELECT count(*) AS subscriptions,
              coalesce(sum(amount), 0) AS monthly_total,
              count(*) FILTER (WHERE next_due <= current_date + interval '7 days') AS due_soon,
              coalesce(sum(amount) FILTER (
                WHERE next_due <= current_date + interval '7 days'), 0) AS due_soon_total
         FROM recurring_charges
     ),
     paired AS (
       SELECT (SELECT i.amount FROM invoices i
                WHERE i.vendor_id = r.vendor_id AND i.status <> 'rejected'
                ORDER BY i.invoice_date DESC LIMIT 1) AS latest,
              (SELECT i.amount FROM invoices i
                WHERE i.vendor_id = r.vendor_id AND i.status <> 'rejected'
                  AND i.invoice_date < date_trunc('year', current_date)
                ORDER BY i.invoice_date DESC LIMIT 1) AS prior
         FROM recurring_charges r
     ),
     movement AS (
       SELECT count(*) AS increases,
              avg((latest / prior - 1) * 100) AS avg_increase
         FROM paired
        WHERE prior IS NOT NULL AND prior > 0 AND latest > prior * 1.01
     )
     SELECT * FROM totals, movement`,
  );
  return {
    subscriptions: num(row?.subscriptions),
    monthlyTotal: num(row?.monthly_total),
    dueSoon: num(row?.due_soon),
    dueSoonTotal: num(row?.due_soon_total),
    increases: num(row?.increases),
    avgIncreasePct: num(row?.avg_increase),
  };
}

export type RecurringCharge = {
  vendor: string;
  category: string;
  amount: number;
  cadence: string;
  nextDue: string;
  rising: boolean;
};

export async function recurringCharges(): Promise<RecurringCharge[]> {
  const rows = await query<{
    vendor: string;
    category: string;
    amount: string;
    cadence: string;
    next_due: string;
    is_rising: boolean;
  }>(
    `SELECT v.name AS vendor, r.category, r.amount, r.cadence, r.next_due::text, r.is_rising
       FROM recurring_charges r
       JOIN vendors v ON v.id = r.vendor_id
      ORDER BY r.amount DESC`,
  );
  return rows.map((r) => ({
    vendor: r.vendor,
    category: r.category,
    amount: num(r.amount),
    cadence: r.cadence,
    nextDue: r.next_due,
    rising: r.is_rising,
  }));
}

/* ── Fraud ────────────────────────────────────────────────── */

export type FraudStats = {
  openCount: number;
  highCount: number;
  duplicateCount: number;
  exposure: number;
  avgResolveDays: number | null;
};

export async function fraudStats(): Promise<FraudStats> {
  const row = await queryOne<Record<string, string | null>>(
    `SELECT count(*) FILTER (WHERE status = 'open') AS open_count,
            count(*) FILTER (WHERE status = 'open' AND severity = 'high') AS high_count,
            count(*) FILTER (WHERE status = 'open' AND title ILIKE 'duplicate%') AS duplicate_count,
            coalesce(sum(exposure) FILTER (WHERE status = 'open'), 0) AS exposure,
            avg(extract(epoch FROM (resolved_at - opened_at)) / 86400) FILTER (
              WHERE resolved_at IS NOT NULL
                AND opened_at >= current_date - interval '90 days') AS avg_resolve_days
       FROM fraud_flags`,
  );
  return {
    openCount: num(row?.open_count),
    highCount: num(row?.high_count),
    duplicateCount: num(row?.duplicate_count),
    exposure: num(row?.exposure),
    avgResolveDays: row?.avg_resolve_days === null ? null : num(row?.avg_resolve_days),
  };
}

export type FraudFlag = {
  id: string;
  title: string;
  note: string;
  severity: "high" | "med" | "low";
  exposure: number;
  invoiceSlug: string | null;
  invoiceId: string | null;
};

export async function openFraudFlags(): Promise<FraudFlag[]> {
  const rows = await query<{
    id: string;
    title: string;
    note: string;
    severity: "high" | "med" | "low";
    exposure: string;
    slug: string | null;
    invoice_id: string | null;
  }>(
    `SELECT f.id, f.title, f.note, f.severity, f.exposure, f.invoice_id, v.slug
       FROM fraud_flags f
       LEFT JOIN invoices i ON i.id = f.invoice_id
       LEFT JOIN vendors v ON v.id = i.vendor_id
      WHERE f.status IN ('open', 'investigating')
      ORDER BY CASE f.severity WHEN 'high' THEN 0 WHEN 'med' THEN 1 ELSE 2 END, f.opened_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    note: r.note,
    severity: r.severity,
    exposure: num(r.exposure),
    invoiceSlug: r.slug,
    invoiceId: r.invoice_id,
  }));
}

/* ── Approvals ────────────────────────────────────────────── */

export const APPROVAL_TABS = ["Pending", "Approved", "Rejected"] as const;
export type ApprovalTab = (typeof APPROVAL_TABS)[number];

const APPROVAL_STATUSES: Record<ApprovalTab, InvoiceStatus[]> = {
  Pending: ["pending_review", "flagged"],
  Approved: ["approved"],
  Rejected: ["rejected"],
};

export type ApprovalRow = {
  id: string;
  vendor: string;
  slug: string;
  category: string;
  date: string;
  amount: number;
  submittedBy: string;
  flags: number;
};

export async function listApprovals(tab: ApprovalTab, limit = 40): Promise<ApprovalRow[]> {
  const rows = await query<{
    id: string;
    vendor: string;
    slug: string;
    category: string;
    invoice_date: string;
    amount: string;
    submitted_by: string;
    flags: string;
  }>(
    `SELECT i.id, v.name AS vendor, v.slug, i.category, i.invoice_date::text,
            i.amount, i.submitted_by,
            (SELECT count(*) FROM invoice_flags f
              WHERE f.invoice_id = i.id AND f.cleared_at IS NULL) AS flags
       FROM invoices i
       JOIN vendors v ON v.id = i.vendor_id
      WHERE i.status = ANY ($1)
      ORDER BY i.invoice_date DESC
      LIMIT $2`,
    [APPROVAL_STATUSES[tab], limit],
  );
  return rows.map((r) => ({
    id: r.id,
    vendor: r.vendor,
    slug: r.slug,
    category: r.category,
    date: r.invoice_date,
    amount: num(r.amount),
    submittedBy: r.submitted_by,
    flags: num(r.flags),
  }));
}

/* ── Budgets & alerts ─────────────────────────────────────── */

export type BudgetRow = { label: string; category: string | null; used: number; cap: number };

export async function budgetUsage(): Promise<BudgetRow[]> {
  const rows = await query<{ label: string; category: string | null; used: string; cap: string }>(
    `SELECT b.label, b.category, b.monthly_cap AS cap,
            coalesce(sum(i.amount), 0) AS used
       FROM budgets b
       LEFT JOIN invoices i
              ON i.category = b.category
             AND i.status <> 'rejected'
             AND i.invoice_date >= date_trunc('month', current_date)
      GROUP BY b.id, b.label, b.category, b.monthly_cap, b.sort_order
      ORDER BY b.sort_order`,
  );
  return rows.map((r) => ({
    label: r.label,
    category: r.category,
    used: num(r.used),
    cap: num(r.cap),
  }));
}

export type AlertRule = {
  id: string;
  label: string;
  threshold: string;
  channels: string[];
  paused: boolean;
};

export async function alertRules(): Promise<AlertRule[]> {
  const rows = await query<{
    id: string;
    label: string;
    threshold_kind: string;
    threshold_value: string;
    channels: string[];
    is_paused: boolean;
  }>(
    `SELECT id, label, threshold_kind, threshold_value, channels, is_paused
       FROM alert_rules ORDER BY is_paused, created_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    threshold:
      r.threshold_kind === "percent_of_cap"
        ? `${num(r.threshold_value)}%`
        : `$${num(r.threshold_value).toLocaleString("en-US")}`,
    channels: r.channels,
    paused: r.is_paused,
  }));
}

export type AlertEvent = { id: string; message: string; icon: string; at: Date };

export async function alertEvents(limit = 3): Promise<AlertEvent[]> {
  const rows = await query<{ id: string; message: string; icon: string; occurred_at: Date }>(
    `SELECT id, message, icon, occurred_at FROM alert_events
      ORDER BY occurred_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ id: r.id, message: r.message, icon: r.icon, at: r.occurred_at }));
}

/* ── Vendors ──────────────────────────────────────────────── */

export type VendorDirectoryRow = {
  vendor: string;
  slug: string;
  category: string;
  monthlyAvg: number;
  since: string | null;
  invoices: number;
};

export async function vendorDirectory(): Promise<VendorDirectoryRow[]> {
  const rows = await query<{
    vendor: string;
    slug: string;
    category: string;
    monthly_avg: string;
    since: string | null;
    invoices: string;
  }>(
    `SELECT v.name AS vendor, v.slug, v.category, v.customer_since::text AS since,
            coalesce(sum(i.amount) FILTER (
              WHERE i.invoice_date >= current_date - interval '6 months'), 0) / 6 AS monthly_avg,
            count(i.id) AS invoices
       FROM vendors v
       LEFT JOIN invoices i ON i.vendor_id = v.id AND i.status <> 'rejected'
      GROUP BY v.id, v.name, v.slug, v.category, v.customer_since
      ORDER BY monthly_avg DESC, v.name`,
  );
  return rows.map((r) => ({
    vendor: r.vendor,
    slug: r.slug,
    category: r.category,
    monthlyAvg: num(r.monthly_avg),
    since: r.since,
    invoices: num(r.invoices),
  }));
}

/* ── Assets ───────────────────────────────────────────────── */

export const ASSET_TYPE_TABS = ["All types", "Phone lines", "Meters", "Licenses", "Hardware"] as const;
export type AssetTypeTab = (typeof ASSET_TYPE_TABS)[number];

const TAB_TO_KIND: Record<AssetTypeTab, string | null> = {
  "All types": null,
  "Phone lines": "phone",
  Meters: "meter",
  Licenses: "license",
  Hardware: "hardware",
};

export type AssetStats = {
  total: number;
  monthlyCost: number;
  idle: number;
  locations: number;
  regions: number;
};

export async function assetStats(): Promise<AssetStats> {
  const row = await queryOne<Record<string, string>>(
    `SELECT count(*) AS total,
            coalesce(sum(monthly_cost), 0) AS monthly_cost,
            count(*) FILTER (WHERE is_idle) AS idle,
            (SELECT count(*) FROM locations) AS locations,
            (SELECT count(DISTINCT region) FROM locations) AS regions
       FROM assets`,
  );
  return {
    total: num(row?.total),
    monthlyCost: num(row?.monthly_cost),
    idle: num(row?.idle),
    locations: num(row?.locations),
    regions: num(row?.regions),
  };
}

export const assetRegions = cache(async () => {
  const rows = await query<{ region: string }>(
    `SELECT DISTINCT region FROM locations ORDER BY region`,
  );
  return ["All regions", ...rows.map((r) => r.region)];
});

export type AssetRow = {
  label: string;
  identifier: string;
  vendor: string;
  location: string | null;
  region: string | null;
  monthlyCost: number;
  idle: boolean;
};

export async function listAssets(options: {
  type: AssetTypeTab;
  region: string;
  search: string;
  page: number;
  size: number;
}): Promise<{ rows: AssetRow[]; total: number }> {
  const rows = await query<{
    label: string;
    identifier: string;
    vendor: string;
    location: string | null;
    region: string | null;
    monthly_cost: string;
    is_idle: boolean;
    total: string;
  }>(
    `SELECT a.label, a.identifier, v.name AS vendor, l.name AS location, l.region,
            a.monthly_cost, a.is_idle, count(*) OVER () AS total
       FROM assets a
       JOIN vendors v ON v.id = a.vendor_id
       LEFT JOIN locations l ON l.id = a.location_id
      WHERE ($1::text IS NULL OR a.kind = $1)
        AND ($2::text IS NULL OR l.region = $2)
        AND ($3 = '' OR a.label ILIKE '%' || $3 || '%'
                     OR a.identifier ILIKE '%' || $3 || '%'
                     OR v.name ILIKE '%' || $3 || '%'
                     OR l.name ILIKE '%' || $3 || '%')
      ORDER BY a.kind, a.identifier
      LIMIT $4 OFFSET $5`,
    [
      TAB_TO_KIND[options.type],
      options.region === "All regions" ? null : options.region,
      options.search,
      options.size,
      options.page * options.size,
    ],
  );
  return {
    total: rows.length > 0 ? num(rows[0].total) : 0,
    rows: rows.map((r) => ({
      label: r.label,
      identifier: r.identifier,
      vendor: r.vendor,
      location: r.location,
      region: r.region,
      monthlyCost: num(r.monthly_cost),
      idle: r.is_idle,
    })),
  };
}

/* ── Locations ────────────────────────────────────────────── */

export type LocationStats = {
  total: number;
  regions: number;
  avgAssets: number;
  medianAssets: number;
  monthlyCost: number;
};

export async function locationStats(): Promise<LocationStats> {
  const row = await queryOne<Record<string, string>>(
    `WITH per_location AS (
       SELECT l.id, count(a.id) AS assets, coalesce(sum(a.monthly_cost), 0) AS cost
         FROM locations l LEFT JOIN assets a ON a.location_id = l.id
        GROUP BY l.id
     )
     SELECT count(*) AS total,
            (SELECT count(DISTINCT region) FROM locations) AS regions,
            coalesce(round(avg(assets)), 0) AS avg_assets,
            coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY assets), 0) AS median_assets,
            coalesce(sum(cost), 0) AS monthly_cost
       FROM per_location`,
  );
  return {
    total: num(row?.total),
    regions: num(row?.regions),
    avgAssets: num(row?.avg_assets),
    medianAssets: Math.round(num(row?.median_assets)),
    monthlyCost: num(row?.monthly_cost),
  };
}

export type LocationRow = {
  name: string;
  region: string;
  address: string;
  assets: number;
  cost: number;
};

export async function listLocations(options: {
  search: string;
  page: number;
  size: number;
}): Promise<{ rows: LocationRow[]; total: number }> {
  const rows = await query<{
    name: string;
    region: string;
    address: string;
    assets: string;
    cost: string;
    total: string;
  }>(
    `SELECT l.name, l.region, l.address,
            count(a.id) AS assets, coalesce(sum(a.monthly_cost), 0) AS cost,
            count(*) OVER () AS total
       FROM locations l
       LEFT JOIN assets a ON a.location_id = l.id
      WHERE ($1 = '' OR l.name ILIKE '%' || $1 || '%'
                     OR l.region ILIKE '%' || $1 || '%'
                     OR l.address ILIKE '%' || $1 || '%')
      GROUP BY l.id, l.name, l.region, l.address
      ORDER BY length(l.name), l.name
      LIMIT $2 OFFSET $3`,
    [options.search, options.size, options.page * options.size],
  );
  return {
    total: rows.length > 0 ? num(rows[0].total) : 0,
    rows: rows.map((r) => ({
      name: r.name,
      region: r.region,
      address: r.address,
      assets: num(r.assets),
      cost: num(r.cost),
    })),
  };
}

/* ── Expense agent ────────────────────────────────────────── */

export type AgentTurn = {
  id: string;
  role: "user" | "assistant";
  body: string;
  toolCalls: { tool: string; detail: string }[];
};

export async function latestConversation(): Promise<{ title: string; turns: AgentTurn[] } | null> {
  const conversation = await queryOne<{ id: string; title: string }>(
    `SELECT id, title FROM agent_conversations ORDER BY created_at DESC LIMIT 1`,
  );
  if (!conversation) return null;

  const messages = await query<{ id: string; role: "user" | "assistant"; body: string }>(
    `SELECT id, role, body FROM agent_messages WHERE conversation_id = $1 ORDER BY created_at`,
    [conversation.id],
  );
  const calls = await query<{ message_id: string; tool: string; detail: string }>(
    `SELECT c.message_id, c.tool, c.detail
       FROM agent_tool_calls c
       JOIN agent_messages m ON m.id = c.message_id
      WHERE m.conversation_id = $1
      ORDER BY c.sort_order`,
    [conversation.id],
  );

  return {
    title: conversation.title,
    turns: messages.map((m) => ({
      id: m.id,
      role: m.role,
      body: m.body,
      toolCalls: calls.filter((c) => c.message_id === m.id).map((c) => ({ tool: c.tool, detail: c.detail })),
    })),
  };
}

export type TrendSeries = { categories: string[]; series: { name: string; data: number[] }[] };

/**
 * Monthly spend for the biggest vendors in the given categories — what the
 * expense agent's utilities answer is looking at.
 */
export async function vendorTrend(options: {
  categories: string[];
  months?: number;
  limit?: number;
}): Promise<TrendSeries> {
  const months = options.months ?? 4;
  const limit = options.limit ?? 3;

  const rows = await query<{ month: string; sort: string; vendor: string; total: string }>(
    `WITH recent AS (
       SELECT i.vendor_id, i.invoice_date, i.amount
         FROM invoices i
        WHERE i.status <> 'rejected'
          AND i.category = ANY ($1)
          AND i.invoice_date >= date_trunc('month', current_date) - make_interval(months => $2::int - 1)
     ),
     top_vendors AS (
       SELECT vendor_id FROM recent
        GROUP BY vendor_id ORDER BY sum(amount) DESC LIMIT $3
     )
     SELECT to_char(date_trunc('month', w.invoice_date), 'Mon') AS month,
            to_char(date_trunc('month', w.invoice_date), 'YYYY-MM') AS sort,
            v.name AS vendor,
            sum(w.amount) AS total
       FROM recent w
       JOIN top_vendors t ON t.vendor_id = w.vendor_id
       JOIN vendors v ON v.id = w.vendor_id
      GROUP BY 1, 2, 3
      ORDER BY 2`,
    [options.categories, months, limit],
  );

  const categories = [...new Set(rows.map((r) => r.month))];
  const names = [...new Set(rows.map((r) => r.vendor))];
  return {
    categories,
    series: names.map((name) => ({
      name,
      data: categories.map((month) =>
        Math.round(
          rows
            .filter((r) => r.month === month && r.vendor === name)
            .reduce((sum, r) => sum + num(r.total), 0),
        ),
      ),
    })),
  };
}
