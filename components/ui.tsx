import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { TONE_CLASS, categoryStyle, type Tone } from "@/lib/data";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 rounded-[22px] border border-line bg-surface p-[18px] ${className}`}
    >
      {children}
    </div>
  );
}

/** A card whose children run edge to edge — table and list shells. */
export function TableCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 overflow-hidden rounded-[22px] border border-line bg-surface ${className}`}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <span className="text-[15px] font-bold tracking-[-0.02em]">{children}</span>;
}

export function TableTitle({ children }: { children: ReactNode }) {
  return <span className="text-[14.5px] font-bold tracking-[-0.02em]">{children}</span>;
}

export function TableHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-[10px] border-b border-line-soft px-[18px] py-[14px]">
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px] rounded-[18px] border border-line bg-surface p-[15px]">
      <span className="text-[11.5px] text-muted">{label}</span>
      <span className="text-[24px] leading-[1.1] font-bold tracking-[-0.03em]">{value}</span>
      <span className="text-[11px] text-muted">{sub}</span>
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-[10px] lg:grid-cols-4 lg:gap-3">{children}</div>
  );
}

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-[3px] text-[10.5px] font-medium whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/** The rounded tile that carries a category or status icon in list rows. */
export function IconTile({
  icon,
  size = 34,
  iconSize = 16,
  radius = 11,
  bg,
  fg,
}: {
  icon: IconName;
  size?: number;
  iconSize?: number;
  radius?: number;
  bg: string;
  fg: string;
}) {
  return (
    <span
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size, borderRadius: radius, background: bg, color: fg }}
    >
      <Icon name={icon} size={iconSize} />
    </span>
  );
}

export function CategoryTile({
  category,
  size,
  iconSize,
  radius,
}: {
  category: string;
  size?: number;
  iconSize?: number;
  radius?: number;
}) {
  const c = categoryStyle(category);
  return (
    <IconTile icon={c.icon} bg={c.bg} fg={c.fg} size={size} iconSize={iconSize} radius={radius} />
  );
}

/**
 * Search that actually filters: a GET form whose `q` lands in `searchParams`.
 * Other filters already in the URL ride along as hidden fields so searching
 * does not drop the current tab or region.
 */
export function SearchForm({
  action,
  placeholder,
  defaultValue = "",
  keep = {},
  className = "",
}: {
  action: string;
  placeholder: string;
  defaultValue?: string;
  keep?: Record<string, string | undefined>;
  className?: string;
}) {
  return (
    <form
      action={action}
      method="get"
      role="search"
      className={`flex min-w-0 items-center gap-2 rounded-[14px] border border-line bg-surface px-[13px] py-[9px] ${className}`}
    >
      {Object.entries(keep).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <Icon name="search" size={16} className="shrink-0 text-muted" />
        <span className="sr-only">{placeholder}</span>
        <input
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
        />
      </label>
      <button
        type="submit"
        className="shrink-0 cursor-pointer rounded-full border border-line px-[10px] py-[3px] text-[11px] font-medium text-body-soft"
      >
        Search
      </button>
    </form>
  );
}

/* ── Tables ───────────────────────────────────────────────── */

export type Column = {
  label: string;
  /** Grid track for this column, e.g. "minmax(110px,1fr)". */
  track: string;
  align?: "right";
  mono?: boolean;
};

export function DataTable({
  columns,
  rows,
}: {
  columns: Column[];
  rows: ReactNode[][];
}) {
  const template = columns.map((c) => c.track).join(" ");
  return (
    <div className="min-w-0 overflow-x-auto">
      <div
        className="grid min-w-[620px]"
        style={{ gridTemplateColumns: template }}
        role="table"
      >
        {columns.map((c) => (
          <div
            key={c.label}
            role="columnheader"
            className={`border-b border-line bg-[#fafbf9] px-[14px] py-[11px] font-mono text-[9.5px] tracking-[0.1em] text-faint uppercase ${
              c.align === "right" ? "text-right" : ""
            }`}
          >
            {c.label}
          </div>
        ))}
        {rows.map((row, ri) =>
          row.map((cell, ci) => (
            <div
              key={`${ri}-${ci}`}
              role="cell"
              className={[
                "px-[14px] py-3",
                ri < rows.length - 1 ? "border-b border-line-faint" : "",
                ci === 0 ? "text-[12.5px] font-medium text-ink" : "text-[12.5px] text-body-soft",
                columns[ci].mono || columns[ci].align === "right" ? "font-mono text-[11.5px]" : "",
                columns[ci].align === "right" ? "text-right" : "",
              ].join(" ")}
            >
              {cell}
            </div>
          )),
        )}
      </div>
    </div>
  );
}

export function Pager({
  label,
  prevHref,
  nextHref,
}: {
  label: string;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const base =
    "rounded-full border border-line bg-surface px-[14px] py-[6px] text-[11.5px] font-medium";
  return (
    <div className="flex flex-wrap items-center gap-[10px] border-t border-line-soft px-[18px] py-[11px]">
      <span className="font-mono text-[11px] text-muted">{label}</span>
      <div className="ml-auto flex gap-[6px]">
        {prevHref ? (
          <Link href={prevHref} className={base} rel="prev">
            Prev
          </Link>
        ) : (
          <span className={`${base} opacity-40`} aria-disabled>
            Prev
          </span>
        )}
        {nextHref ? (
          <Link href={nextHref} className={base} rel="next">
            Next
          </Link>
        ) : (
          <span className={`${base} opacity-40`} aria-disabled>
            Next
          </span>
        )}
      </div>
    </div>
  );
}

/** Shown in place of rows when a query comes back empty. */
export function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-line-soft px-[18px] py-9 text-center text-[12.5px] text-muted">
      {children}
    </div>
  );
}

/* ── Layout helpers ───────────────────────────────────────── */

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-[14px]">{children}</div>;
}

export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-[10px] lg:grid-cols-2 lg:gap-3 xl:grid-cols-3">
      {children}
    </div>
  );
}

/** A square icon button for the page header's action slot (<HeaderActions>) — same size as the menu button. */
export const headerIconClass =
  "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[12px] border border-line bg-surface text-ink hover:bg-bg";
