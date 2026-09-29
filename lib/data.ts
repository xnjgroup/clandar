/**
 * Design and navigation config — everything here is a presentation choice, not
 * data. Records, totals and history come from Postgres via `lib/queries.ts`.
 */
import type { IconName } from "@/components/icons";

export type Tone = "ok" | "warn" | "bad" | "idle";

export const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-fg",
  warn: "bg-warn-bg text-warn-fg",
  bad: "bg-bad-bg text-bad-fg",
  idle: "bg-idle-bg text-idle-fg",
};

/* ── Categories ───────────────────────────────────────────── */

type CategoryStyle = { bg: string; fg: string; icon: IconName };

/** Tiles for the categories the `categories` table ships with. */
const CATEGORIES: Record<string, CategoryStyle> = {
  Telecom: { bg: "#eaf3d8", fg: "#41631a", icon: "phone" },
  Utilities: { bg: "#dcefe8", fg: "#1f6b52", icon: "droplet" },
  Dining: { bg: "#fbe9d8", fg: "#8a4e1a", icon: "fork" },
  Software: { bg: "#e2e8f4", fg: "#33477a", icon: "laptop" },
  Travel: { bg: "#f3e2f0", fg: "#7a2f6c", icon: "plane" },
  "Rent/facilities": { bg: "#f2f4ef", fg: "#4c4f47", icon: "building" },
};

const FALLBACK_CATEGORY: CategoryStyle = { bg: "#f2f4ef", fg: "#4c4f47", icon: "doc" };

/** A category added in the database with no tile here gets the neutral one. */
export function categoryStyle(name: string): CategoryStyle {
  return CATEGORIES[name] ?? FALLBACK_CATEGORY;
}

/** Donut slices, in the order the overview chart lists categories. */
export const CATEGORY_COLORS: Record<string, string> = {
  Telecom: "#8dc63f",
  Utilities: "#d7f56b",
  Dining: "#f4a259",
  Software: "#7ea6d9",
  Travel: "#c98bc9",
  "Rent/facilities": "#e6e3d8",
};

export const CHART_SERIES_COLORS = ["#8dc63f", "#7ea6d9", "#f4a259", "#c98bc9", "#d7f56b"];

/* ── Jobs ─────────────────────────────────────────────────── */

export type Trade =
  | "painting"
  | "plumbing"
  | "electrical"
  | "drywall"
  | "flooring"
  | "tile"
  | "siding"
  | "deck-fence"
  | "paver-patio"
  | "handyman-repair";

export const TRADES: { id: Trade; label: string; icon: IconName }[] = [
  { id: "painting", label: "Painting", icon: "brush" },
  { id: "plumbing", label: "Plumbing", icon: "droplet" },
  { id: "electrical", label: "Electrical", icon: "bolt" },
  { id: "drywall", label: "Drywall", icon: "building2" },
  { id: "flooring", label: "Flooring", icon: "layers" },
  { id: "tile", label: "Tile", icon: "grid" },
  { id: "siding", label: "Siding", icon: "home" },
  { id: "deck-fence", label: "Deck & Fence", icon: "fence" },
  { id: "paver-patio", label: "Paver & Patio", icon: "square" },
  { id: "handyman-repair", label: "Handyman Repair", icon: "wrench" },
];

export type JobStatus = "lead" | "quoted" | "scheduled" | "in_progress" | "completed" | "cancelled";

export const JOB_STATUSES: { id: JobStatus; label: string }[] = [
  { id: "lead", label: "Lead" },
  { id: "quoted", label: "Quoted" },
  { id: "scheduled", label: "Scheduled" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

/* ── Invoice status ───────────────────────────────────────── */

export type InvoiceStatus =
  | "extracted"
  | "pending_review"
  | "flagged"
  | "approved"
  | "rejected";

const STATUS_PRESENTATION: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  extracted: { label: "extracted", tone: "ok" },
  pending_review: { label: "pending review", tone: "warn" },
  flagged: { label: "flagged", tone: "bad" },
  approved: { label: "approved", tone: "ok" },
  rejected: { label: "rejected", tone: "idle" },
};

export const statusLabel = (status: InvoiceStatus) => STATUS_PRESENTATION[status].label;
export const statusTone = (status: InvoiceStatus) => STATUS_PRESENTATION[status].tone;

export const LINE_TAG_CLASS: Record<string, string> = {
  credit: "bg-[#eaf3d8] text-[#41631a]",
  "one-time": "bg-warn-bg text-warn-fg",
  recurring: "bg-idle-bg text-body-soft",
  tax: "bg-idle-bg text-body-soft",
};

/* ── Navigation ───────────────────────────────────────────── */

export type NavItem = { label: string; icon: IconName; href: string };
export type NavGroup = { label: string; icon: IconName; items: NavItem[] };

/** The always-visible top-level rows — kept to a handful so the sidebar reads at a glance. */
export const NAV_TOP: NavItem[] = [
  { label: "Overview", icon: "home", href: "/overview" },
  { label: "Jobs", icon: "briefcase", href: "/jobs" },
  { label: "Customers", icon: "users", href: "/customers" },
  { label: "Schedule", icon: "calendar", href: "/schedule" },
  { label: "Tasks", icon: "clipboard", href: "/tasks" },
  { label: "Email", icon: "mail", href: "/email" },
];

/** Everything else, folded into two collapsible submenus (see components/app-shell.tsx). */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Finance",
    icon: "wallet",
    items: [
      { label: "Invoices", icon: "doc", href: "/invoices" },
      { label: "Expenses", icon: "chart", href: "/expenses" },
      { label: "Recurring", icon: "refresh", href: "/recurring" },
      { label: "Budgets", icon: "wallet", href: "/budgets" },
      { label: "Approvals", icon: "check2", href: "/approvals" },
      { label: "Fraud", icon: "shield", href: "/fraud" },
      { label: "Messages", icon: "chat", href: "/messages" },
    ],
  },
  {
    label: "Directory",
    icon: "building2",
    items: [
      { label: "Vendors", icon: "building", href: "/vendors" },
      { label: "Assets", icon: "gauge", href: "/assets" },
      { label: "Locations", icon: "building2", href: "/locations" },
    ],
  },
];

/** Pinned below everything else, above the account menu — workspace-level config, not a "page" in the main sense. */
export const NAV_FOOTER: NavItem[] = [
  { label: "Connectors", icon: "robot", href: "/connectors" },
  { label: "Settings", icon: "settings", href: "/settings" },
];

export const MOBILE_TABS: { label: string; icon: IconName; href: string }[] = [
  { label: "Overview", icon: "home", href: "/overview" },
  { label: "Jobs", icon: "briefcase", href: "/jobs" },
  { label: "Schedule", icon: "calendar", href: "/schedule" },
  { label: "Tasks", icon: "clipboard", href: "/tasks" },
];

export const USER_MENU: { label: string; icon: IconName; danger?: boolean }[] = [
  { label: "Profile & preferences", icon: "user" },
  { label: "Company settings", icon: "building" },
  { label: "Billing & plan", icon: "card" },
  { label: "Sign out", icon: "logout", danger: true },
];

/** Breadcrumb + title per route, keyed by the first path segment. */
export const PAGE_TITLES: Record<string, [crumb: string, title: string]> = {
  overview: ["Overview", "Overview"],
  jobs: ["Work", "Jobs"],
  customers: ["Work", "Customers"],
  schedule: ["Work", "Schedule"],
  tasks: ["Work", "Tasks"],
  invoices: ["Invoices", "Invoices & extraction"],
  email: ["Workspace", "Email"],
  expenses: ["Reporting", "Expenses"],
  recurring: ["Reporting", "Recurring charges"],
  fraud: ["Risk", "Fraud & anomalies"],
  approvals: ["Workflow", "Approvals"],
  budgets: ["Planning", "Budgets"],
  assets: ["Directory", "Assets"],
  locations: ["Directory", "Locations"],
  connectors: ["Automation", "Connectors"],
  settings: ["Automation", "Settings"],
  vendors: ["Directory", "Vendors & accounts"],
  messages: ["Workspace", "Expense agent"],
};

/* ── Formatting ───────────────────────────────────────────── */

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Whole-dollar form, used where cents would be noise (budgets, site costs). */
export const money0 = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export const count = (n: number) => n.toLocaleString("en-US");

/** "Aug 14" for in-year dates, "Aug 14, 2025" otherwise. */
export function shortDate(value: Date | string, reference = new Date()) {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  const sameYear = date.getFullYear() === reference.getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function longDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "2h ago", "3d ago" — for event logs and connector checks. */
export function relativeTime(value: Date | string | null) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return longDate(date);
}

/** Percentage change, or "new" when there is no prior-period baseline. */
export function delta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? "0%" : "new";
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct === 0 ? "0%" : `${pct > 0 ? "+" : ""}${pct}%`;
}

export function greeting(name: string | null, now = new Date()) {
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return name ? `Good ${part}, ${name.split(" ")[0]}` : `Good ${part}`;
}

/* ── Pagination ───────────────────────────────────────────── */

export type Page = { page: number; size: number; pages: number; from: number; to: number; total: number };

export function pageInfo(total: number, page: number, size: number): Page {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  return {
    page: p,
    size,
    pages,
    from: total === 0 ? 0 : p * size + 1,
    to: Math.min(total, p * size + size),
    total,
  };
}

/** Reads a 0-based page number out of `?page=`, which is 1-based in the URL. */
export function pageParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed - 1 : 0;
}

export function firstParam(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() || "";
}

export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * A link to the same page with some params changed — how tabs, filters and the
 * pager move state around while the pages stay server-rendered. `null` drops a
 * param.
 */
export function hrefWith(
  path: string,
  current: SearchParams,
  updates: Record<string, string | number | null>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) params.set(key, first);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

/** Prev/next hrefs for a `Pager`, or null at either end. Pages are 1-based in the URL. */
export function pagerHrefs(path: string, current: SearchParams, info: Page) {
  return {
    prevHref: info.page > 0 ? hrefWith(path, current, { page: info.page }) : null,
    nextHref: info.page < info.pages - 1 ? hrefWith(path, current, { page: info.page + 2 }) : null,
  };
}
