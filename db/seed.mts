/**
 * Fills clandar_expense with a coherent starting set: people, vendors,
 * locations, assets, two years of invoices with line items, budgets, alerts,
 * fraud flags and one agent transcript.
 *
 *   npm run db:seed          # replaces the expense data, keeps connectors
 *   npm run db:seed -- --all # also clears connectors and OAuth state
 *
 * Amounts in the current month are chosen so the dashboard tells a real story
 * (utilities near its cap, dining over it, a duplicated telecom invoice), and
 * everything else is generated from a fixed PRNG seed so runs are repeatable.
 */
import { Client } from "pg";

const includeConnectors = process.argv.includes("--all");

/* ── Deterministic randomness ─────────────────────────────── */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260926);
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Splits a total into `parts` amounts that add back up to it exactly. */
function splitAmount(total: number, parts: number): number[] {
  const cents = Math.round(total * 100);
  const weights = Array.from({ length: parts }, () => between(0.6, 1.4));
  const sum = weights.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let used = 0;
  for (let i = 0; i < parts - 1; i++) {
    const slice = Math.max(1, Math.round((cents * weights[i]) / sum));
    out.push(slice / 100);
    used += slice;
  }
  out.push((cents - used) / 100);
  return out;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

/* ── Reference data ───────────────────────────────────────── */

const CATEGORIES = [
  "Telecom",
  "Utilities",
  "Dining",
  "Software",
  "Travel",
  "Rent/facilities",
] as const;
type Category = (typeof CATEGORIES)[number];

const REGIONS = ["West", "South", "Northeast", "Midwest", "Remote"] as const;
/** Licenses live in the "Remote" group; physical assets sit at a site. */
const SITE_REGIONS = REGIONS.filter((r) => r !== "Remote");

// Historical/demo people only — none of these can sign in (no google_sub).
// They exist purely so seeded invoices have someone to show as the approver.
const PEOPLE = [
  { name: "Mei Kwan", email: "mei.kwan@acmecorp.test", role: "owner" },
  { name: "Dana Ortiz", email: "dana.ortiz@acmecorp.test", role: "approver" },
  { name: "Priya Raman", email: "priya.raman@acmecorp.test", role: "member" },
  { name: "Tom Bledsoe", email: "tom.bledsoe@acmecorp.test", role: "member" },
  { name: "Sam Iyer", email: "sam.iyer@acmecorp.test", role: "member" },
  { name: "Ruth Okafor", email: "ruth.okafor@acmecorp.test", role: "member" },
];

type VendorSeed = {
  name: string;
  category: Category;
  account: string | null;
  since: string;
  /** Typical monthly invoice, used to generate history and recurring rows. */
  baseline: number;
  recurring: boolean;
  rising?: boolean;
};

const VENDORS: VendorSeed[] = [
  { name: "Comcast Business", category: "Telecom", account: "8829-4471-02", since: "2024-01-08", baseline: 838.2, recurring: true, rising: true },
  { name: "Spectrum Enterprise", category: "Telecom", account: "5591-0281", since: "2024-03-04", baseline: 612.4, recurring: true, rising: true },
  { name: "Verizon", category: "Telecom", account: "VZ-4410-77", since: "2024-09-02", baseline: 410.4, recurring: true },
  { name: "AT&T Business", category: "Telecom", account: "ATT-90218", since: "2025-01-13", baseline: 268.5, recurring: false },
  { name: "Cisco Meraki", category: "Telecom", account: "MRK-2291", since: "2025-04-01", baseline: 0, recurring: false },
  { name: "PG&E", category: "Utilities", account: "4410-2288-01", since: "2024-01-08", baseline: 1102.6, recurring: true, rising: true },
  { name: "City Water & Sewer", category: "Utilities", account: "MTR-W-88213", since: "2024-01-08", baseline: 284.15, recurring: true },
  { name: "Austin Energy", category: "Utilities", account: "AE-55120", since: "2024-11-05", baseline: 496.8, recurring: false },
  { name: "ConEd", category: "Utilities", account: "CE-88210", since: "2025-02-10", baseline: 612.9, recurring: false },
  { name: "The Grove Bistro", category: "Dining", account: null, since: "2025-02-17", baseline: 186.4, recurring: false },
  { name: "Figma", category: "Software", account: "FIG-2291", since: "2024-06-03", baseline: 450, recurring: true },
  { name: "Notion Labs", category: "Software", account: "NOT-1180", since: "2024-08-19", baseline: 320, recurring: true },
  { name: "1Password", category: "Software", account: "1P-77120", since: "2024-10-07", baseline: 96, recurring: true },
  { name: "Slack", category: "Software", account: "SLK-4402", since: "2024-05-20", baseline: 216, recurring: true },
  { name: "Zoom", category: "Software", account: "ZM-9981", since: "2024-07-15", baseline: 178, recurring: true },
  { name: "Delta Air Lines", category: "Travel", account: "DL-99812", since: "2025-05-06", baseline: 892.2, recurring: false },
  { name: "Westside Properties", category: "Rent/facilities", account: "WP-2201", since: "2024-01-02", baseline: 4200, recurring: true },
];

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

type AssetKind = "phone" | "meter" | "license" | "hardware";

const VENDORS_BY_KIND: Record<AssetKind, string[]> = {
  phone: ["Comcast Business", "Spectrum Enterprise", "Verizon", "AT&T Business"],
  meter: ["PG&E", "City Water & Sewer", "Austin Energy", "ConEd"],
  license: ["Figma", "Notion Labs", "1Password", "Slack", "Zoom"],
  hardware: ["Comcast Business", "Cisco Meraki", "Spectrum Enterprise"],
};

const ASSET_KINDS = Object.keys(VENDORS_BY_KIND) as AssetKind[];

const LOCATION_COUNT = 118;
const ASSET_COUNT = 3_000;
const HISTORY_MONTHS = 24;

/* ── Insert helpers ───────────────────────────────────────── */

async function insertMany(
  client: Client,
  table: string,
  columns: string[],
  rows: unknown[][],
  returning?: string,
): Promise<Record<string, string>[]> {
  if (rows.length === 0) return [];
  const perStatement = Math.max(1, Math.floor(60_000 / columns.length));
  const out: Record<string, string>[] = [];

  for (let start = 0; start < rows.length; start += perStatement) {
    const chunk = rows.slice(start, start + perStatement);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const sql =
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}` +
      (returning ? ` RETURNING ${returning}` : "");
    const result = await client.query(sql, params);
    out.push(...result.rows);
  }
  return out;
}

/* ── Seed ─────────────────────────────────────────────────── */

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();

try {
  await client.query("BEGIN");

  const tables = [
    "agent_tool_calls",
    "agent_messages",
    "agent_conversations",
    "fraud_flags",
    "alert_events",
    "alert_rules",
    "budgets",
    "recurring_charges",
    "invoice_flags",
    "invoice_line_items",
    "invoices",
    "assets",
    "vendors",
    "locations",
    "categories",
    "people",
  ];
  if (includeConnectors) tables.unshift("oauth_states", "connector_events", "connector_tools", "connectors");
  await client.query(`TRUNCATE ${tables.join(", ")} CASCADE`);

  /* People */
  const people = await insertMany(
    client,
    "people",
    ["name", "email", "role"],
    PEOPLE.map((p) => [p.name, p.email, p.role]),
    "id, name",
  );
  const personId = new Map(people.map((p) => [p.name, p.id]));

  /* Categories */
  await insertMany(
    client,
    "categories",
    ["name", "sort_order"],
    CATEGORIES.map((name, i) => [name, i]),
  );

  /* Locations */
  const locationRows = Array.from({ length: LOCATION_COUNT }, (_, i) => {
    const region = REGIONS[i % REGIONS.length];
    const remote = region === "Remote";
    return [
      remote ? `Remote / SaaS group ${i + 1}` : `Site #${i + 1}`,
      region,
      remote ? "No physical address" : `${1000 + i * 4} Commerce Dr, ${region} Region`,
    ];
  });
  const locations = await insertMany(
    client,
    "locations",
    ["name", "region", "address"],
    locationRows,
    "id, region, name",
  );
  const locationsByRegion = new Map<string, string[]>();
  for (const loc of locations) {
    const list = locationsByRegion.get(loc.region) ?? [];
    list.push(loc.id);
    locationsByRegion.set(loc.region, list);
  }

  /* Vendors */
  const vendors = await insertMany(
    client,
    "vendors",
    ["name", "slug", "category", "account_number", "customer_since"],
    VENDORS.map((v) => [v.name, slugify(v.name), v.category, v.account, v.since]),
    "id, name",
  );
  const vendorId = new Map(vendors.map((v) => [v.name, v.id]));
  const vendorByName = new Map(VENDORS.map((v) => [v.name, v]));

  /* Assets */
  const assetRows: unknown[][] = [];
  // Round-robin within each region so every site ends up with assets.
  const regionCursor = new Map<string, number>();
  for (let i = 0; i < ASSET_COUNT; i++) {
    const kind = ASSET_KINDS[i % ASSET_KINDS.length];
    const vendorName = VENDORS_BY_KIND[kind][i % VENDORS_BY_KIND[kind].length];
    // Licenses are per-seat and belong to the remote group; the rest sit at a site.
    // Kind cycles every asset, so the region advances every full cycle —
    // otherwise a region would only ever see one kind of asset.
    const region =
      kind === "license"
        ? "Remote"
        : SITE_REGIONS[Math.floor(i / ASSET_KINDS.length) % SITE_REGIONS.length];
    const candidates = locationsByRegion.get(region) ?? [];

    let label: string;
    let identifier: string;
    if (kind === "phone") {
      label = `Voice line — (${200 + (i % 700)}) 555-${String(1000 + (i % 8999)).slice(1)}`;
      identifier = `LN-${10_000 + i}`;
    } else if (kind === "meter") {
      label = i % 2 === 0 ? "Electric meter" : "Water meter";
      identifier = `MTR-${2_000_000 + i}`;
    } else if (kind === "license") {
      label = `${vendorName} seat`;
      identifier = `SEAT-${5_000 + i}`;
    } else {
      label = "Business Internet circuit";
      identifier = `SVC-${400_000 + i}`;
    }

    const cursor = regionCursor.get(region) ?? 0;
    regionCursor.set(region, cursor + 1);

    assetRows.push([
      kind,
      label,
      identifier,
      vendorId.get(vendorName),
      candidates.length ? candidates[cursor % candidates.length] : null,
      round2(18 + ((i * 37) % 480)),
      i % 37 === 0,
    ]);
  }
  await insertMany(
    client,
    "assets",
    ["kind", "label", "identifier", "vendor_id", "location_id", "monthly_cost", "is_idle"],
    assetRows,
  );

  const assetsByVendor = new Map<string, { label: string; identifier: string; kind: AssetKind }[]>();
  // An invoice is billed to one site; use the first site the vendor serves.
  const siteByVendor = new Map<string, string>();
  for (const row of assetRows) {
    const [kind, label, identifier, vid, locationId] = row as [
      AssetKind,
      string,
      string,
      string,
      string | null,
    ];
    const list = assetsByVendor.get(vid) ?? [];
    if (list.length < 8) list.push({ kind, label, identifier });
    assetsByVendor.set(vid, list);
    if (locationId && !siteByVendor.has(vid)) siteByVendor.set(vid, locationId);
  }

  /* Invoices — the current month is curated, earlier months are generated. */
  type InvoiceSeed = {
    vendor: string;
    amount: number;
    date: Date;
    status: "extracted" | "pending_review" | "flagged" | "approved" | "rejected";
    submittedBy?: string;
    approver?: string;
    pages?: number;
    confidence?: number;
    featured?: boolean;
    duplicate?: boolean;
  };

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dayIn = (offset: number) =>
    new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(offset, now.getDate()));

  const current: InvoiceSeed[] = [
    // Telecom — the featured document, plus the duplicate that trips fraud.
    { vendor: "Comcast Business", amount: 838.2, date: dayIn(14), status: "flagged", pages: 3, confidence: 0.97, approver: "Dana Ortiz", featured: true },
    { vendor: "Comcast Business", amount: 838.2, date: dayIn(14), status: "flagged", pages: 3, confidence: 0.96, approver: "Dana Ortiz", duplicate: true },
    { vendor: "Spectrum Enterprise", amount: 612.4, date: dayIn(12), status: "extracted", pages: 2, confidence: 0.98 },
    // Utilities — lands at ~87% of a $1,600 cap.
    { vendor: "PG&E", amount: 1102.6, date: dayIn(9), status: "pending_review", pages: 4, confidence: 0.91, submittedBy: "Priya Raman" },
    { vendor: "City Water & Sewer", amount: 284.15, date: dayIn(10), status: "extracted", pages: 1, confidence: 0.99 },
    // Dining — three meals put the category over a $600 cap.
    { vendor: "The Grove Bistro", amount: 186.4, date: dayIn(8), status: "pending_review", submittedBy: "Tom Bledsoe", confidence: 0.94 },
    { vendor: "The Grove Bistro", amount: 240.0, date: dayIn(15), status: "extracted", submittedBy: "Tom Bledsoe", confidence: 0.95 },
    { vendor: "The Grove Bistro", amount: 294.0, date: dayIn(21), status: "extracted", submittedBy: "Sam Iyer", confidence: 0.93 },
    // Software
    { vendor: "Figma", amount: 450, date: dayIn(6), status: "approved", submittedBy: "Dana Ortiz", approver: "Mei Kwan" },
    { vendor: "Notion Labs", amount: 320, date: dayIn(6), status: "approved", approver: "Mei Kwan" },
    { vendor: "1Password", amount: 96, date: dayIn(7), status: "approved", approver: "Mei Kwan" },
    { vendor: "Slack", amount: 216, date: dayIn(4), status: "approved", approver: "Mei Kwan" },
    { vendor: "Zoom", amount: 178, date: dayIn(5), status: "approved", approver: "Mei Kwan" },
    // Travel & rent
    { vendor: "Delta Air Lines", amount: 892.2, date: dayIn(3), status: "pending_review", submittedBy: "Sam Iyer" },
    { vendor: "Westside Properties", amount: 4200, date: dayIn(1), status: "approved", submittedBy: "Mei Kwan", approver: "Mei Kwan" },
    { vendor: "AT&T Business", amount: 268.5, date: dayIn(2), status: "rejected", submittedBy: "Ruth Okafor", approver: "Mei Kwan" },
  ];

  const history: InvoiceSeed[] = [];
  for (let back = 1; back <= HISTORY_MONTHS; back++) {
    const month = new Date(now.getFullYear(), now.getMonth() - back, 1);
    for (const vendor of VENDORS) {
      if (vendor.baseline === 0) continue;
      // Recurring vendors bill every month; the rest show up now and then.
      const invoiceCount = vendor.recurring ? 1 : rand() < 0.45 ? 1 : 0;
      for (let n = 0; n < invoiceCount; n++) {
        const drift = vendor.rising ? 1 - back * 0.006 : 1;
        const amount = round2(vendor.baseline * drift * between(0.92, 1.08));
        const day = 1 + Math.floor(rand() * 27);
        history.push({
          vendor: vendor.name,
          amount,
          date: new Date(month.getFullYear(), month.getMonth(), day),
          status: rand() < 0.04 ? "rejected" : "approved",
          submittedBy: rand() < 0.5 ? "Ingested via upload" : pick(PEOPLE).name,
          approver: rand() < 0.7 ? "Mei Kwan" : "Dana Ortiz",
          confidence: round2(between(0.9, 0.99)),
          pages: 1 + Math.floor(rand() * 4),
        });
      }
    }
  }

  const allInvoices = [...current, ...history];
  const invoiceRows = allInvoices.map((inv) => {
    const vendor = vendorByName.get(inv.vendor)!;
    const date = inv.date;
    const periodEnd = addDays(date, -1);
    return [
      vendorId.get(inv.vendor),
      vendor.category,
      siteByVendor.get(vendorId.get(inv.vendor)!) ?? null,
      iso(date),
      inv.amount,
      inv.status,
      inv.pages ?? 1 + Math.floor(rand() * 3),
      inv.confidence ?? round2(between(0.9, 0.99)),
      vendor.account,
      iso(addDays(periodEnd, -30)),
      iso(periodEnd),
      iso(addDays(date, 22)),
      vendor.recurring ? "ACH autopay" : "Corporate card",
      0,
      inv.submittedBy ?? "Ingested via upload",
      inv.approver ? personId.get(inv.approver) : null,
      inv.status === "approved" || inv.status === "rejected" ? addDays(date, 2).toISOString() : null,
    ];
  });

  const inserted = await insertMany(
    client,
    "invoices",
    [
      "vendor_id",
      "category",
      "location_id",
      "invoice_date",
      "amount",
      "status",
      "page_count",
      "ocr_confidence",
      "account_number",
      "period_start",
      "period_end",
      "due_date",
      "payment_method",
      "prior_balance",
      "submitted_by",
      "approver_id",
      "decided_at",
    ],
    invoiceRows,
    "id",
  );
  const invoiceIds = inserted.map((r) => r.id);
  console.log(`inserted ${invoiceIds.length} invoices`);

  /* Line items — the featured invoice is itemized by hand, the rest derived. */
  const FEATURED_LINES: [icon: string, group: string, id: string, tag: string, desc: string, amount: number][] = [
    ["router", "Business Internet 500 Mbps", "SVC-00218-A", "recurring", "Monthly service fee", 389.0],
    ["router", "Business Internet 500 Mbps", "SVC-00218-A", "recurring", "Static IP block (/29)", 45.0],
    ["sim", "Voice line · (510) 555-0148", "LN-0148", "recurring", "Line plan, 4 seats", 220.0],
    ["router", "Equipment — router replacement", "SN-RT-88213", "one-time", "Hardware fee, non-recurring", 149.9],
    ["gauge", "Regulatory & tax", null as unknown as string, "tax", "Surcharges across all lines", 96.3],
    ["gauge", "Regulatory & tax", null as unknown as string, "credit", "Service credit — outage last cycle", -62.0],
  ];

  const ICON_BY_KIND: Record<AssetKind, string> = {
    phone: "sim",
    meter: "gauge",
    license: "laptop",
    hardware: "router",
  };

  const lineRows: unknown[][] = [];
  allInvoices.forEach((inv, index) => {
    const id = invoiceIds[index];

    if (inv.featured) {
      FEATURED_LINES.forEach(([icon, group, identifier, tag, desc, amount], i) => {
        lineRows.push([id, null, group, identifier, icon, tag, desc, amount, i]);
      });
      return;
    }

    const vendor = vendorByName.get(inv.vendor)!;
    const vid = vendorId.get(inv.vendor)!;
    const assets = assetsByVendor.get(vid) ?? [];
    const tax = round2(inv.amount * 0.07);
    const serviceTotal = round2(inv.amount - tax);
    const groups = assets.length === 0 ? 1 : 1 + Math.floor(rand() * Math.min(2, assets.length));
    const shares = splitAmount(serviceTotal, groups);

    shares.forEach((share, i) => {
      const asset = assets[i % Math.max(1, assets.length)];
      lineRows.push([
        id,
        null,
        asset ? asset.label : `${vendor.name} service`,
        asset ? asset.identifier : null,
        asset ? ICON_BY_KIND[asset.kind] : "doc",
        vendor.recurring ? "recurring" : "one-time",
        vendor.recurring ? "Monthly service charge" : "Charges for this period",
        share,
        i,
      ]);
    });

    lineRows.push([
      id,
      null,
      "Regulatory & tax",
      null,
      "gauge",
      "tax",
      "Surcharges and local taxes",
      tax,
      shares.length,
    ]);
  });

  await insertMany(
    client,
    "invoice_line_items",
    [
      "invoice_id",
      "asset_id",
      "group_label",
      "group_identifier",
      "group_icon",
      "tag",
      "description",
      "amount",
      "sort_order",
    ],
    lineRows,
  );
  console.log(`inserted ${lineRows.length} line items`);

  /* Invoice-level flags on the two contested telecom documents */
  const featuredIndex = allInvoices.findIndex((i) => i.featured);
  const duplicateIndex = allInvoices.findIndex((i) => i.duplicate);
  await insertMany(
    client,
    "invoice_flags",
    ["invoice_id", "label"],
    [
      [invoiceIds[featuredIndex], "Amount Due > Current Charges — residual balance carried forward"],
      [
        invoiceIds[featuredIndex],
        "Duplicate charge suspected — matches another invoice from the same billing period",
      ],
      [
        invoiceIds[duplicateIndex],
        "Duplicate charge suspected — matches another invoice from the same billing period",
      ],
    ],
  );

  /* Recurring charges */
  await insertMany(
    client,
    "recurring_charges",
    ["vendor_id", "category", "amount", "cadence", "next_due", "is_rising", "icon"],
    VENDORS.filter((v) => v.recurring).map((v, i) => [
      vendorId.get(v.name),
      v.category,
      v.baseline,
      "month",
      iso(addDays(now, 2 + ((i * 3) % 27))),
      Boolean(v.rising),
      v.category === "Telecom" ? "phone" : v.category === "Utilities" ? "bolt" : v.category === "Software" ? "laptop" : "building",
    ]),
  );

  /* Budgets */
  await insertMany(
    client,
    "budgets",
    ["label", "category", "monthly_cap", "sort_order"],
    [
      ["Telecom", "Telecom", 2000, 0],
      ["Utilities", "Utilities", 1600, 1],
      ["Dining & meals", "Dining", 600, 2],
      ["Software", "Software", 1800, 3],
      ["Travel", "Travel", 1500, 4],
      ["Rent/facilities", "Rent/facilities", 4200, 5],
    ],
  );

  /* Alert rules and the log of what they fired */
  const rules = await insertMany(
    client,
    "alert_rules",
    ["label", "threshold_kind", "threshold_value", "channels", "is_paused"],
    [
      ["Utilities — 85% of monthly cap", "percent_of_cap", 85, ["Email", "Push"], false],
      ["Telecom — 100% of monthly cap", "percent_of_cap", 100, ["Email", "SMS", "Push"], false],
      ["Any single invoice over $2,000", "absolute_amount", 2000, ["SMS", "Push"], false],
      ["Dining & meals — 90% of cap", "percent_of_cap", 90, ["Email"], true],
    ],
    "id, label",
  );
  const ruleId = new Map(rules.map((r) => [r.label, r.id]));

  await insertMany(
    client,
    "alert_events",
    ["alert_rule_id", "message", "icon", "occurred_at"],
    [
      [
        ruleId.get("Utilities — 85% of monthly cap"),
        "Utilities crossed 87% of the monthly cap — email + push sent to Mei Kwan",
        "bellSm",
        new Date(now.getTime() - 2 * 3_600_000).toISOString(),
      ],
      [
        ruleId.get("Telecom — 100% of monthly cap"),
        "Telecom passed 100% of cap after a duplicate Comcast Business invoice — SMS sent to Mei Kwan and Dana Ortiz",
        "message",
        new Date(now.getTime() - 26 * 3_600_000).toISOString(),
      ],
      [
        ruleId.get("Any single invoice over $2,000"),
        "Westside Properties invoice $4,200.00 exceeded the $2,000 single-invoice rule — SMS sent to Mei Kwan",
        "mail",
        new Date(now.getTime() - 3 * 86_400_000).toISOString(),
      ],
    ],
  );

  /* Fraud flags — two open, three resolved so the stats have a history */
  await insertMany(
    client,
    "fraud_flags",
    ["invoice_id", "title", "note", "severity", "exposure", "status", "opened_at", "resolved_at"],
    [
      [
        invoiceIds[duplicateIndex],
        "Duplicate charge — Comcast Business",
        "Two invoices for the same billing period, $838.20 each, submitted six minutes apart from different upload sessions.",
        "high",
        838.2,
        "open",
        new Date(now.getTime() - 2 * 86_400_000).toISOString(),
        null,
      ],
      [
        invoiceIds[allInvoices.findIndex((i) => i.vendor === "The Grove Bistro" && i.amount === 294)],
        "Unusual spend spike — The Grove Bistro",
        "Dining charge 58% above this vendor's six-month average. No prior pattern of increases this size.",
        "med",
        294,
        "open",
        new Date(now.getTime() - 1 * 86_400_000).toISOString(),
        null,
      ],
      [null, "Card-not-present charge — unrecognised merchant", "Charge did not match any vendor on file. Confirmed as a mistyped account number.", "med", 310, "dismissed", new Date(now.getTime() - 40 * 86_400_000).toISOString(), new Date(now.getTime() - 39 * 86_400_000).toISOString()],
      [null, "Rate change — PG&E", "Unannounced tariff change flagged by the anomaly check. Verified against the utility's published rates.", "low", 84, "dismissed", new Date(now.getTime() - 61 * 86_400_000).toISOString(), new Date(now.getTime() - 59 * 86_400_000).toISOString()],
      [null, "Duplicate charge — Spectrum Enterprise", "Two identical line items inside one invoice. Vendor issued a credit.", "high", 612.4, "confirmed", new Date(now.getTime() - 80 * 86_400_000).toISOString(), new Date(now.getTime() - 78 * 86_400_000).toISOString()],
    ],
  );

  /* One agent transcript, so /messages has real content */
  const [conversation] = await insertMany(
    client,
    "agent_conversations",
    ["title", "person_id"],
    [["Utilities budget check", personId.get("Mei Kwan")]],
    "id",
  );

  const messages = await insertMany(
    client,
    "agent_messages",
    ["conversation_id", "role", "body", "created_at"],
    [
      [
        conversation.id,
        "user",
        "How are we tracking against the utilities budget this month?",
        new Date(now.getTime() - 3_600_000).toISOString(),
      ],
      [
        conversation.id,
        "assistant",
        "You're at 87% of the Utilities budget with the month not closed yet. Comcast is the outlier in telecom — the same $838.20 invoice landed twice, which is what pushed that category over its cap. Water and sewer both held flat.",
        new Date(now.getTime() - 3_590_000).toISOString(),
      ],
    ],
    "id, role",
  );
  const assistantId = messages.find((m) => m.role === "assistant")!.id;

  await insertMany(
    client,
    "agent_tool_calls",
    ["message_id", "tool", "detail", "sort_order"],
    [
      [assistantId, "recurring.query", "utilities.* · monthly totals, last 4 cycles", 0],
      [assistantId, "vendor.compare", "Comcast Business vs. 6-month average", 1],
    ],
  );

  await client.query("COMMIT");

  const counts = await client.query<{ table_name: string; rows: string }>(
    `SELECT relname AS table_name, n_live_tup::text AS rows
       FROM pg_stat_user_tables
      WHERE n_live_tup > 0
      ORDER BY n_live_tup DESC`,
  );
  console.log("\nseeded:");
  for (const row of counts.rows) console.log(`  ${row.rows.padStart(6)}  ${row.table_name}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
