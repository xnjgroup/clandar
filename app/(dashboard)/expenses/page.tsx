import { TabLinks } from "@/components/tabs";
import { DataTable, EmptyRow, PageBody, TableCard, type Column } from "@/components/ui";
import { count, delta, firstParam, hrefWith, money } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { categorySpend, monthlySpend, vendorSpend } from "@/lib/queries";

const EXPENSE_TABS = ["By vendor", "By category", "By month"] as const;
type ExpenseTab = (typeof EXPENSE_TABS)[number];

const PATH = "/expenses";

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

export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  const params = await searchParams;
  const requested = firstParam(params.view) as ExpenseTab;
  const tab = EXPENSE_TABS.includes(requested) ? requested : "By vendor";
  const { org } = await requireSession();

  let columns: Column[];
  let rows: string[][];

  if (tab === "By vendor") {
    columns = VENDOR_COLUMNS;
    rows = (await vendorSpend(org.id)).map((v) => [
      v.vendor,
      v.category,
      money(v.thisMonth),
      money(v.lastMonth),
      delta(v.thisMonth, v.lastMonth),
    ]);
  } else if (tab === "By category") {
    columns = CATEGORY_COLUMNS;
    rows = (await categorySpend(org.id)).map((c) => [
      c.category,
      count(c.vendors),
      money(c.thisMonth),
      money(c.lastMonth),
      delta(c.thisMonth, c.lastMonth),
    ]);
  } else {
    columns = MONTH_COLUMNS;
    const months = await monthlySpend(org.id, 6);
    rows = months.map((m, i) => [
      m.month,
      count(m.invoices),
      money(m.total),
      i === 0 ? "—" : delta(m.total, months[i - 1].total),
    ]);
  }

  return (
    <PageBody>
      <TabLinks
        options={EXPENSE_TABS}
        value={tab}
        label="Expense breakdown"
        href={(option) =>
          hrefWith(PATH, params, { view: option === "By vendor" ? null : option })
        }
      />
      <TableCard>
        {rows.length === 0 ? (
          <EmptyRow>No spend recorded for this period.</EmptyRow>
        ) : (
          <DataTable columns={columns} rows={rows} />
        )}
      </TableCard>
    </PageBody>
  );
}
