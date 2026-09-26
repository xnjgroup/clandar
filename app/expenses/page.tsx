"use client";

import { useState } from "react";
import { TabList } from "@/components/tabs";
import { DataTable, PageBody, TableCard, type Column } from "@/components/ui";
import {
  EXPENSE_TABS,
  MONTHLY_SPEND,
  VENDOR_SPEND,
  money,
  type ExpenseTab,
} from "@/lib/data";

/** Percentage change, or "new" when there is no prior-period baseline. */
function delta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? "0%" : "new";
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct === 0 ? "0%" : `${pct > 0 ? "+" : ""}${pct}%`;
}

const VENDOR_COLUMNS: Column[] = [
  { label: "Vendor", track: "minmax(140px,1.6fr)" },
  { label: "Category", track: "minmax(80px,0.8fr)", mono: true },
  { label: "This month", track: "minmax(90px,1fr)", align: "right" },
  { label: "Last month", track: "minmax(90px,1fr)", align: "right" },
  { label: "Δ", track: "minmax(60px,0.7fr)", align: "right" },
];

const CATEGORY_COLUMNS: Column[] = [
  { label: "Category", track: "minmax(140px,1.6fr)" },
  { label: "Vendors", track: "minmax(80px,0.8fr)", mono: true },
  { label: "This month", track: "minmax(90px,1fr)", align: "right" },
  { label: "Last month", track: "minmax(90px,1fr)", align: "right" },
  { label: "Δ", track: "minmax(60px,0.7fr)", align: "right" },
];

const MONTH_COLUMNS: Column[] = [
  { label: "Month", track: "minmax(140px,1.6fr)" },
  { label: "Invoices", track: "minmax(80px,0.8fr)", mono: true },
  { label: "Total", track: "minmax(90px,1fr)", align: "right" },
  { label: "Δ vs prior", track: "minmax(90px,0.9fr)", align: "right" },
];

function byCategory() {
  const groups = new Map<string, { vendors: number; thisMonth: number; lastMonth: number }>();
  for (const v of VENDOR_SPEND) {
    const g = groups.get(v.category) ?? { vendors: 0, thisMonth: 0, lastMonth: 0 };
    g.vendors += 1;
    g.thisMonth += v.thisMonth;
    g.lastMonth += v.lastMonth;
    groups.set(v.category, g);
  }
  return [...groups.entries()].sort((a, b) => b[1].thisMonth - a[1].thisMonth);
}

export default function ExpensesPage() {
  const [tab, setTab] = useState<ExpenseTab>("By vendor");

  let columns: Column[];
  let rows: string[][];

  if (tab === "By vendor") {
    columns = VENDOR_COLUMNS;
    rows = VENDOR_SPEND.map((v) => [
      v.vendor,
      v.category,
      money(v.thisMonth),
      money(v.lastMonth),
      delta(v.thisMonth, v.lastMonth),
    ]);
  } else if (tab === "By category") {
    columns = CATEGORY_COLUMNS;
    rows = byCategory().map(([category, g]) => [
      category,
      String(g.vendors),
      money(g.thisMonth),
      money(g.lastMonth),
      delta(g.thisMonth, g.lastMonth),
    ]);
  } else {
    columns = MONTH_COLUMNS;
    rows = MONTHLY_SPEND.map((m, i) => [
      m.month,
      String(m.invoices),
      money(m.total),
      i === 0 ? "—" : delta(m.total, MONTHLY_SPEND[i - 1].total),
    ]);
  }

  return (
    <PageBody>
      <TabList options={EXPENSE_TABS} value={tab} onChange={setTab} label="Expense breakdown" />
      <TableCard>
        <DataTable columns={columns} rows={rows} />
      </TableCard>
    </PageBody>
  );
}
