import type { IconName } from "@/components/icons";

export type Tone = "ok" | "warn" | "bad" | "idle";

export const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-fg",
  warn: "bg-warn-bg text-warn-fg",
  bad: "bg-bad-bg text-bad-fg",
  idle: "bg-idle-bg text-idle-fg",
};

/* ── Categories ───────────────────────────────────────────── */

export type CategoryName =
  | "Telecom"
  | "Utilities"
  | "Dining"
  | "Software"
  | "Travel"
  | "Rent/facilities";

type CategoryStyle = { bg: string; fg: string; icon: IconName };

const CATEGORIES: Record<CategoryName, CategoryStyle> = {
  Telecom: { bg: "#eaf3d8", fg: "#41631a", icon: "phone" },
  Utilities: { bg: "#dcefe8", fg: "#1f6b52", icon: "droplet" },
  Dining: { bg: "#fbe9d8", fg: "#8a4e1a", icon: "fork" },
  Software: { bg: "#e2e8f4", fg: "#33477a", icon: "laptop" },
  Travel: { bg: "#f3e2f0", fg: "#7a2f6c", icon: "plane" },
  "Rent/facilities": { bg: "#f2f4ef", fg: "#4c4f47", icon: "building" },
};

const FALLBACK_CATEGORY: CategoryStyle = { bg: "#f2f4ef", fg: "#4c4f47", icon: "doc" };

export function categoryStyle(name: string): CategoryStyle {
  return CATEGORIES[name as CategoryName] ?? FALLBACK_CATEGORY;
}

/* ── Navigation ───────────────────────────────────────────── */

export type NavItem = { label: string; icon: IconName; href: string; badge?: string };

export const NAV: NavItem[] = [
  { label: "Overview", icon: "home", href: "/" },
  { label: "Invoices", icon: "doc", href: "/invoices" },
  { label: "Expenses", icon: "chart", href: "/expenses" },
  { label: "Recurring", icon: "refresh", href: "/recurring" },
  { label: "Fraud", icon: "shield", href: "/fraud", badge: "3" },
  { label: "Approvals", icon: "check2", href: "/approvals", badge: "4" },
  { label: "Budgets", icon: "wallet", href: "/budgets" },
  { label: "Vendors", icon: "building", href: "/vendors" },
  { label: "Assets", icon: "gauge", href: "/assets" },
  { label: "Locations", icon: "building2", href: "/locations" },
  { label: "Connectors", icon: "robot", href: "/connectors" },
];

export const MOBILE_TABS: { label: string; icon: IconName; href: string }[] = [
  { label: "Overview", icon: "home", href: "/" },
  { label: "Invoices", icon: "doc", href: "/invoices" },
  { label: "Approvals", icon: "check2", href: "/approvals" },
  { label: "Messages", icon: "chat", href: "/messages" },
];

export const USER_MENU: { label: string; icon: IconName; danger?: boolean }[] = [
  { label: "Profile & preferences", icon: "user" },
  { label: "Company settings", icon: "building" },
  { label: "Billing & plan", icon: "card" },
  { label: "Sign out", icon: "logout", danger: true },
];

/** Breadcrumb + title per route, keyed by the first path segment. */
export const PAGE_TITLES: Record<string, [crumb: string, title: string]> = {
  "": ["Good morning, Mei", "Overview"],
  invoices: ["Invoices", "Invoices & extraction"],
  expenses: ["Reporting", "Expenses"],
  recurring: ["Reporting", "Recurring charges"],
  fraud: ["Risk", "Fraud & anomalies"],
  approvals: ["Workflow", "Approvals"],
  budgets: ["Planning", "Budgets"],
  assets: ["Directory", "Assets"],
  locations: ["Directory", "Locations"],
  connectors: ["Automation", "Vendor connectors"],
  vendors: ["Directory", "Vendors & accounts"],
  messages: ["Workspace", "Expense agent"],
};

/* ── Overview ─────────────────────────────────────────────── */

export const OVERVIEW_STATS = [
  { label: "Spend this month", value: "$3,802", sub: "+6% vs last month" },
  { label: "Pending approval", value: "$2,140", sub: "4 invoices waiting" },
  { label: "Flagged", value: "2", sub: "duplicate & spike detected" },
  { label: "Recurring monthly", value: "$2,410", sub: "across 11 vendors" },
];

export const SPEND_BY_CATEGORY = {
  labels: ["Telecom", "Utilities", "Dining", "Software", "Travel", "Rent/facilities"],
  series: [1240, 890, 640, 410, 380, 240],
  colors: ["#8dc63f", "#d7f56b", "#f4a259", "#7ea6d9", "#c98bc9", "#e6e3d8"],
  total: "$3,800",
};

export const NEEDS_ATTENTION = [
  {
    title: "Comcast Business invoice 14% above trend",
    note: "Flagged as a spend anomaly · $1,248.90 vs ~$1,090 average",
    severity: "high" as const,
    icon: "alert" as IconName,
    href: "/invoices/comcast-business",
  },
  {
    title: "PG&E invoice awaiting review",
    note: "OCR confidence 91% — one line item needs confirmation",
    severity: "med" as const,
    icon: "clock" as IconName,
    href: "/invoices",
  },
  {
    title: "4 invoices pending approval",
    note: "$2,140 total, oldest submitted 3 days ago",
    severity: "med" as const,
    icon: "check2" as IconName,
    href: "/approvals",
  },
];

/* ── Invoices ─────────────────────────────────────────────── */

export type InvoiceRow = {
  vendor: string;
  category: string;
  date: string;
  amount: string;
  status: string;
  tone: Tone;
  pages: string;
};

export const RECENT_INVOICES: InvoiceRow[] = [
  { vendor: "Comcast Business", category: "Telecom", date: "Aug 14", amount: "$1,248.90", status: "flagged", tone: "bad", pages: "3 pages" },
  { vendor: "Spectrum Enterprise", category: "Telecom", date: "Aug 12", amount: "$612.40", status: "extracted", tone: "ok", pages: "2 pages" },
  { vendor: "City Water & Sewer", category: "Utilities", date: "Aug 10", amount: "$284.15", status: "extracted", tone: "ok", pages: "1 page" },
  { vendor: "PG&E", category: "Utilities", date: "Aug 9", amount: "$1,102.60", status: "pending review", tone: "warn", pages: "4 pages" },
  { vendor: "The Grove Bistro", category: "Dining", date: "Aug 8", amount: "$186.40", status: "extracted", tone: "ok", pages: "1 page" },
];

const ALL_VENDORS = [
  "Comcast Business",
  "Spectrum Enterprise",
  "City Water & Sewer",
  "PG&E",
  "The Grove Bistro",
  "Figma",
  "Delta Air Lines",
  "Westside Properties",
];

const INVOICE_CATEGORIES: CategoryName[] = [
  "Telecom",
  "Utilities",
  "Dining",
  "Software",
  "Travel",
  "Rent/facilities",
];

const INVOICE_STATUS_CYCLE: [string, Tone][] = [
  ["extracted", "ok"],
  ["extracted", "ok"],
  ["extracted", "ok"],
  ["pending review", "warn"],
  ["flagged", "bad"],
  ["approved", "ok"],
];

export const INVOICE_TOTAL = 304_812;
export const INVOICE_STATUS_TABS = ["All", "Flagged", "Pending", "Approved"] as const;
export type InvoiceStatusTab = (typeof INVOICE_STATUS_TABS)[number];

/** The archive is deterministic in the row index, so a row is built on demand. */
function invoiceAt(i: number): InvoiceRow {
  const [status, tone] = INVOICE_STATUS_CYCLE[i % INVOICE_STATUS_CYCLE.length];
  const pageCount = 1 + (i % 4);
  return {
    vendor: ALL_VENDORS[i % ALL_VENDORS.length],
    category: INVOICE_CATEGORIES[i % INVOICE_CATEGORIES.length],
    date: `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`,
    amount: `$${(30 + ((i * 53) % 4200) / 1.7).toFixed(2)}`,
    status,
    tone,
    pages: `${pageCount} ${i % 4 === 0 ? "page" : "pages"}`,
  };
}

/** Residues of the status cycle that each tab keeps. */
const INVOICE_TAB_RESIDUES: Record<InvoiceStatusTab, number[]> = {
  All: [0, 1, 2, 3, 4, 5],
  Approved: [5],
  Flagged: [4],
  Pending: [3],
};

export function invoicePage(tab: InvoiceStatusTab, page: number, size: number) {
  const slice = residueSlice(
    INVOICE_TOTAL,
    INVOICE_STATUS_CYCLE.length,
    INVOICE_TAB_RESIDUES[tab],
    page,
    size,
  );
  return { ...slice, rows: slice.indices.map(invoiceAt) };
}

/* ── Invoice detail ───────────────────────────────────────── */

export const INVOICE_SLUGS: Record<string, string> = Object.fromEntries(
  ALL_VENDORS.map((v) => [slugify(v), v]),
);

export function slugify(vendor: string) {
  return vendor
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const INVOICE_DETAIL = {
  date: "Aug 14, 2026",
  confidence: "97%",
  category: "Telecom" as CategoryName,
  nextDue: "Sep 14",
  account: "8829-4471-02",
  location: "140 Industrial Way, Fremont CA",
  total: "$838.20",
  approver: "Pending · Dana Ortiz",
  assets: [
    {
      icon: "router" as IconName,
      label: "Business Internet 500 Mbps",
      identifier: "SVC-00218-A",
      lines: [
        { tag: "recurring", desc: "Monthly service fee", amount: "$389.00" },
        { tag: "recurring", desc: "Static IP block (/29)", amount: "$45.00" },
      ],
    },
    {
      icon: "sim" as IconName,
      label: "Voice line · (510) 555-0148",
      identifier: "LN-0148",
      lines: [{ tag: "recurring", desc: "Line plan, 4 seats", amount: "$220.00" }],
    },
    {
      icon: "router" as IconName,
      label: "Equipment — router replacement",
      identifier: "SN-RT-88213",
      lines: [{ tag: "one-time", desc: "Hardware fee, non-recurring", amount: "$149.90" }],
    },
    {
      icon: "gauge" as IconName,
      label: "Regulatory & tax",
      identifier: "—",
      lines: [
        { tag: "tax", desc: "Surcharges across all lines", amount: "$96.30" },
        { tag: "credit", desc: "Service credit — outage Jul 22", amount: "−$62.00" },
      ],
    },
  ],
  fields: [
    { label: "Account number", value: "8829-4471-02" },
    { label: "Billing period", value: "Jul 14 – Aug 13" },
    { label: "Due date", value: "Sep 5, 2026" },
    { label: "Payment method", value: "ACH autopay" },
    { label: "Prior balance", value: "$0.00" },
    { label: "Late fee risk", value: "None" },
    { label: "Line items extracted", value: "6 of 6" },
  ],
  flags: [
    { label: "Amount Due > Current Charges — residual balance carried forward" },
    { label: "Duplicate charge suspected — matches another invoice from the same billing period" },
  ],
};

export const LINE_TAG_CLASS: Record<string, string> = {
  credit: "bg-[#eaf3d8] text-[#41631a]",
  "one-time": "bg-warn-bg text-warn-fg",
  recurring: "bg-idle-bg text-body-soft",
  tax: "bg-idle-bg text-body-soft",
};

/* ── Expenses ─────────────────────────────────────────────── */

export const EXPENSE_TABS = ["By vendor", "By category", "By month"] as const;
export type ExpenseTab = (typeof EXPENSE_TABS)[number];

export const VENDOR_SPEND = [
  { vendor: "Comcast Business", category: "Telecom", thisMonth: 1248.9, lastMonth: 1096 },
  { vendor: "Spectrum Enterprise", category: "Telecom", thisMonth: 612.4, lastMonth: 598 },
  { vendor: "PG&E", category: "Utilities", thisMonth: 1102.6, lastMonth: 1080 },
  { vendor: "City Water & Sewer", category: "Utilities", thisMonth: 284.15, lastMonth: 279 },
  { vendor: "Figma", category: "Software", thisMonth: 450, lastMonth: 450 },
  { vendor: "The Grove Bistro", category: "Dining", thisMonth: 186.4, lastMonth: 142.2 },
  { vendor: "Delta Air Lines", category: "Travel", thisMonth: 892.2, lastMonth: 0 },
  { vendor: "Westside Properties", category: "Rent/facilities", thisMonth: 4200, lastMonth: 4200 },
];

export const MONTHLY_SPEND = [
  { month: "Mar 2026", total: 7994.65, invoices: 21 },
  { month: "Apr 2026", total: 8210.4, invoices: 23 },
  { month: "May 2026", total: 8102.15, invoices: 22 },
  { month: "Jun 2026", total: 8455.8, invoices: 25 },
  { month: "Jul 2026", total: 7845.2, invoices: 22 },
  { month: "Aug 2026", total: 8976.65, invoices: 26 },
];

/* ── Recurring ────────────────────────────────────────────── */

export const RECURRING_STATS = [
  { label: "Active subscriptions", value: "11", sub: "$2,410 / month" },
  { label: "Due in 7 days", value: "3", sub: "$1,610 combined" },
  { label: "Price increases this year", value: "4", sub: "avg +8.5%" },
];

export const RECURRING_CARDS = [
  { name: "Comcast Business", category: "Telecom", amount: "$1,248.90", cadence: "month", nextDue: "Sep 14", rising: true, icon: "phone" as IconName },
  { name: "PG&E", category: "Utilities", amount: "$1,102.60", cadence: "month", nextDue: "Sep 9", rising: true, icon: "bolt" as IconName },
  { name: "City Water & Sewer", category: "Utilities", amount: "$284.15", cadence: "month", nextDue: "Sep 10", rising: false, icon: "droplet" as IconName },
  { name: "Figma", category: "Software", amount: "$450.00", cadence: "month", nextDue: "Sep 6", rising: false, icon: "laptop" as IconName },
  { name: "Westside Properties", category: "Rent/facilities", amount: "$4,200.00", cadence: "month", nextDue: "Sep 1", rising: false, icon: "building" as IconName },
  { name: "Spectrum Enterprise", category: "Telecom", amount: "$612.40", cadence: "month", nextDue: "Sep 12", rising: true, icon: "phone" as IconName },
];

/* ── Fraud ────────────────────────────────────────────────── */

export const FRAUD_STATS = [
  { label: "Flagged this month", value: "2", sub: "1 duplicate, 1 spend spike" },
  { label: "Exposure at risk", value: "$1,860", sub: "if both confirmed fraud" },
  { label: "Avg time to resolve", value: "1.4 days", sub: "trailing 90 days" },
];

export const FRAUD_FLAGS = [
  {
    title: "Duplicate charge — Comcast Business",
    note: "Two invoices for the same billing period, $1,248.90 each, submitted 6 minutes apart from different upload sessions.",
    severity: "high" as const,
  },
  {
    title: "Unusual spend spike — The Grove Bistro",
    note: "Dining charge 31% above this vendor's 6-month average. No prior pattern of increases this size.",
    severity: "med" as const,
  },
];

/* ── Approvals ────────────────────────────────────────────── */

export const APPROVAL_TABS = ["Pending", "Approved", "Rejected"] as const;
export type ApprovalTab = (typeof APPROVAL_TABS)[number];

export type ApprovalRow = {
  vendor: string;
  submitter: string;
  date: string;
  amount: string;
  category: string;
  flags?: number;
};

export const APPROVALS: Record<ApprovalTab, ApprovalRow[]> = {
  Pending: [
    { vendor: "Comcast Business", submitter: "Ingested via upload", date: "Aug 14", amount: "$1,248.90", category: "Telecom", flags: 2 },
    { vendor: "PG&E", submitter: "Priya Raman", date: "Aug 9", amount: "$1,102.60", category: "Utilities" },
    { vendor: "The Grove Bistro", submitter: "Tom Bledsoe", date: "Aug 8", amount: "$186.40", category: "Dining" },
    { vendor: "Delta Air Lines", submitter: "Sam Iyer", date: "Aug 3", amount: "$892.20", category: "Travel" },
  ],
  Approved: [
    { vendor: "Westside Properties", submitter: "Mei Kwan", date: "Aug 1", amount: "$4,200.00", category: "Rent/facilities" },
    { vendor: "Figma", submitter: "Dana Ortiz", date: "Aug 6", amount: "$450.00", category: "Software" },
  ],
  Rejected: [
    { vendor: "Unknown vendor — no W9", submitter: "Ruth Okafor", date: "Jul 28", amount: "$310.00", category: "Other" },
  ],
};

/* ── Budgets ──────────────────────────────────────────────── */

export const BUDGETS = [
  { category: "Telecom", used: 1861, cap: 2000 },
  { category: "Utilities", used: 1387, cap: 1600 },
  { category: "Dining & meals", used: 720, cap: 600 },
  { category: "Software", used: 1240, cap: 1800 },
  { category: "Travel", used: 892, cap: 1500 },
  { category: "Rent/facilities", used: 4200, cap: 4200 },
];

export const ALERT_RULES = [
  { label: "Utilities — 85% of monthly cap", threshold: "85%", channels: ["Email", "Push"], state: "active", tone: "ok" as Tone },
  { label: "Telecom — 100% of monthly cap", threshold: "100%", channels: ["Email", "SMS", "Push"], state: "active", tone: "ok" as Tone },
  { label: "Any single invoice over $2,000", threshold: "$2,000", channels: ["SMS", "Push"], state: "active", tone: "ok" as Tone },
  { label: "Dining & meals — 90% of cap", threshold: "90%", channels: ["Email"], state: "paused", tone: "idle" as Tone },
];

export const ALERT_LOG = [
  { text: "Utilities crossed 88% of the monthly cap — email + push sent to Mei Kwan", time: "2h ago", icon: "bellSm" as IconName },
  { text: "Comcast Business invoice $1,248.90 exceeded the $2,000 single-invoice rule check — no alert (under threshold)", time: "1d ago", icon: "mail" as IconName },
  { text: "Telecom hit 100% of cap — SMS sent to Mei Kwan and Dana Ortiz", time: "3d ago", icon: "message" as IconName },
];

/* ── Vendors ──────────────────────────────────────────────── */

export const VENDOR_DIRECTORY = [
  { vendor: "Comcast Business", category: "Telecom", monthlyAvg: "$1,150", since: "Jan 2024" },
  { vendor: "Spectrum Enterprise", category: "Telecom", monthlyAvg: "$605", since: "Mar 2024" },
  { vendor: "PG&E", category: "Utilities", monthlyAvg: "$1,080", since: "Jan 2024" },
  { vendor: "City Water & Sewer", category: "Utilities", monthlyAvg: "$281", since: "Jan 2024" },
  { vendor: "Figma", category: "Software", monthlyAvg: "$450", since: "Jun 2024" },
  { vendor: "The Grove Bistro", category: "Dining", monthlyAvg: "$164", since: "Feb 2025" },
  { vendor: "Delta Air Lines", category: "Travel", monthlyAvg: "$620", since: "May 2025" },
  { vendor: "Westside Properties", category: "Rent/facilities", monthlyAvg: "$4,200", since: "Jan 2024" },
];

/* ── Connectors ───────────────────────────────────────────── */

export const CONNECTORS = [
  { vendor: "Comcast Business", method: "API integration", account: "8829-4471-02", status: "synced", tone: "ok" as Tone, lastRun: "2h ago", icon: "link2" as IconName },
  { vendor: "Spectrum Enterprise", method: "API integration", account: "5591-0281", status: "synced", tone: "ok" as Tone, lastRun: "2h ago", icon: "link2" as IconName },
  { vendor: "PG&E", method: "Portal bot · monthly", account: "8829-4471-02", status: "scheduled", tone: "ok" as Tone, lastRun: "Ran Aug 9", icon: "robot" as IconName },
  { vendor: "City Water & Sewer", method: "Portal bot · monthly", account: "MTR-W-88213", status: "scheduled", tone: "ok" as Tone, lastRun: "Ran Aug 10", icon: "robot" as IconName },
  { vendor: "Westside Properties", method: "Portal bot · monthly", account: "WP-2201", status: "login failed", tone: "bad" as Tone, lastRun: "Failed Aug 1", icon: "robot" as IconName },
  { vendor: "1Password", method: "Manual upload only", account: "—", status: "no bot", tone: "idle" as Tone, lastRun: "—", icon: "doc" as IconName },
];

/* ── Messages ─────────────────────────────────────────────── */

export const CHAT_STEPS = [
  { tool: "recurring.query", detail: "utilities.* · monthly totals, last 4 cycles" },
  { tool: "vendor.compare", detail: "Comcast Business vs. 6-month average" },
];

export const CHAT_ANSWER =
  "You're at 88% of the Utilities budget with 9 days left. Comcast rose 14% month over month — mostly a one-time equipment fee. Water and sewer both held flat.";

export const UTILITIES_TREND = {
  categories: ["May", "Jun", "Jul", "Aug"],
  colors: ["#8dc63f", "#7ea6d9", "#f4a259"],
  series: [
    { name: "Electric", data: [142, 138, 151, 149] },
    { name: "Water/sewer", data: [64, 61, 66, 65] },
    { name: "Comcast", data: [110, 112, 108, 128] },
  ],
};

/* ── Assets ───────────────────────────────────────────────── */

export const ASSET_TYPE_TABS = ["All types", "Phone lines", "Meters", "Licenses", "Hardware"] as const;
export type AssetTypeTab = (typeof ASSET_TYPE_TABS)[number];

export const REGIONS = ["All regions", "West", "South", "Northeast", "Midwest", "Remote"] as const;
export type Region = (typeof REGIONS)[number];

const ASSET_KINDS = ["phone", "meter", "license", "hardware"] as const;
type AssetKind = (typeof ASSET_KINDS)[number];

const ASSET_REGIONS = ["West", "South", "Northeast", "Midwest", "Remote"];

const VENDORS_BY_KIND: Record<AssetKind, string[]> = {
  phone: ["Comcast Business", "Spectrum Enterprise", "Verizon", "AT&T Business"],
  meter: ["PG&E", "City Water & Sewer", "Austin Energy", "ConEd"],
  license: ["Figma", "Notion Labs", "1Password", "Slack", "Zoom"],
  hardware: ["Comcast Business", "Cisco Meraki", "Spectrum Enterprise"],
};

const TAB_TO_KIND: Record<Exclude<AssetTypeTab, "All types">, AssetKind> = {
  "Phone lines": "phone",
  Meters: "meter",
  Licenses: "license",
  Hardware: "hardware",
};

export const ASSET_TOTAL = 30_412;

export type Asset = {
  kind: AssetKind;
  region: string;
  vendor: string;
  label: string;
  identifier: string;
  location: string;
  amount: number;
  idle: boolean;
};

function assetAt(i: number): Asset {
  const kind = ASSET_KINDS[i % ASSET_KINDS.length];
  const vendors = VENDORS_BY_KIND[kind];
  const vendor = vendors[i % vendors.length];

  let label: string;
  let identifier: string;
  if (kind === "phone") {
    label = `Voice line — (${200 + (i % 700)}) 555-${String(1000 + (i % 8999)).slice(1)}`;
    identifier = `LN-${10000 + i}`;
  } else if (kind === "meter") {
    label = i % 2 === 0 ? "Electric meter" : "Water meter";
    identifier = `MTR-${2000000 + i}`;
  } else if (kind === "license") {
    label = `${vendor} seat`;
    identifier = `SEAT-${5000 + i}`;
  } else {
    label = "Business Internet circuit";
    identifier = `SVC-${400000 + i}`;
  }

  return {
    kind,
    region: ASSET_REGIONS[i % ASSET_REGIONS.length],
    vendor,
    label,
    identifier,
    location: `Site #${(i % 118) + 1}`,
    amount: 18 + ((i * 37) % 480),
    idle: i % 37 === 0,
  };
}

/**
 * Kind cycles every 4 and region every 5, so membership in a filter depends
 * only on the index modulo 20 — which lets a page be sliced without walking
 * all 30,412 rows.
 */
const ASSET_PERIOD = ASSET_KINDS.length * ASSET_REGIONS.length;

export function assetPage(type: AssetTypeTab, region: Region, page: number, size: number) {
  const wantKind = type === "All types" ? null : TAB_TO_KIND[type];
  const allowed: number[] = [];
  for (let r = 0; r < ASSET_PERIOD; r++) {
    const kindOk = wantKind === null || ASSET_KINDS[r % ASSET_KINDS.length] === wantKind;
    const regionOk = region === "All regions" || ASSET_REGIONS[r % ASSET_REGIONS.length] === region;
    if (kindOk && regionOk) allowed.push(r);
  }
  const slice = residueSlice(ASSET_TOTAL, ASSET_PERIOD, allowed, page, size);
  return { ...slice, rows: slice.indices.map(assetAt) };
}

export const ASSET_STATS = [
  { label: "Total assets tracked", value: ASSET_TOTAL.toLocaleString("en-US"), sub: `across ${ASSET_REGIONS.length} regions` },
  { label: "Monthly cost", value: "$412,204", sub: "sum of all active assets" },
  { label: "Idle / unused", value: Math.round(ASSET_TOTAL / 37).toLocaleString("en-US"), sub: "flagged for cancellation review" },
  { label: "Locations", value: "118", sub: "in 5 regions" },
];

/* ── Locations ────────────────────────────────────────────── */

export const LOCATION_TOTAL = 118;

export type Location = {
  name: string;
  region: string;
  address: string;
  assetCount: number;
  cost: number;
};

export const LOCATIONS: Location[] = Array.from({ length: LOCATION_TOTAL }, (_, i) => {
  const region = ASSET_REGIONS[i % ASSET_REGIONS.length];
  return {
    name: region === "Remote" ? `Remote / SaaS group ${i + 1}` : `Site #${i + 1}`,
    region,
    address: region === "Remote" ? "No physical address" : `${1000 + i * 4} Commerce Dr, ${region} Region`,
    assetCount: 40 + ((i * 13) % 400),
    cost: 800 + ((i * 217) % 6200),
  };
});

export const LOCATION_STATS = [
  { label: "Total locations", value: String(LOCATION_TOTAL), sub: "across 5 regions" },
  { label: "Avg assets / location", value: "258", sub: "median 214" },
  { label: "Total monthly cost", value: "$412,204", sub: "all locations combined" },
];

/* ── Pagination helpers ───────────────────────────────────── */

export type Slice = {
  indices: number[];
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
};

/**
 * Pages through the indices of `[0, total)` whose value modulo `period` is in
 * `allowed`, without materializing the list.
 */
function residueSlice(
  total: number,
  period: number,
  allowed: number[],
  page: number,
  size: number,
): Slice {
  const keep = [...allowed].sort((a, b) => a - b);
  const fullCycles = Math.floor(total / period);
  const remainder = total % period;
  const count = fullCycles * keep.length + keep.filter((r) => r < remainder).length;

  const pages = Math.max(1, Math.ceil(count / size));
  const p = Math.min(Math.max(0, page), pages - 1);

  const indices: number[] = [];
  for (let rank = p * size; rank < Math.min(count, p * size + size); rank++) {
    indices.push(Math.floor(rank / keep.length) * period + keep[rank % keep.length]);
  }

  return {
    indices,
    page: p,
    pages,
    from: count === 0 ? 0 : p * size + 1,
    to: Math.min(count, p * size + size),
    total: count,
  };
}

export function paginate<T>(list: T[], page: number, size: number) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  return {
    rows: list.slice(p * size, p * size + size),
    page: p,
    pages,
    from: list.length === 0 ? 0 : p * size + 1,
    to: Math.min(list.length, p * size + size),
    total: list.length,
  };
}

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Whole-dollar form, used where cents would be noise (budgets, site costs). */
export const money0 = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
