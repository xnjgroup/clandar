import Link from "next/link";
import { CategoryTile, Pill } from "@/components/ui";
import { money, shortDate, statusLabel, statusTone } from "@/lib/data";
import type { InvoiceListRow } from "@/lib/queries";

export function InvoiceListRow({
  row,
  showPages = false,
}: {
  row: InvoiceListRow;
  showPages?: boolean;
}) {
  return (
    <Link
      href={`/invoices/${row.slug}?id=${row.id}`}
      className="flex min-h-[60px] min-w-0 items-center gap-3 border-t border-line-soft px-[18px] py-3 hover:bg-[#fafbf9]"
    >
      <CategoryTile category={row.category} />
      <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
        <span className="truncate text-[13px] font-semibold">{row.vendor}</span>
        <span className="text-[11px] text-muted">
          {row.category} · {shortDate(row.date)}
          {showPages ? ` · ${row.pageCount} page${row.pageCount === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <Pill tone={statusTone(row.status)}>{statusLabel(row.status)}</Pill>
      <span className="ml-2 shrink-0 font-mono text-[12.5px] font-medium">{money(row.amount)}</span>
    </Link>
  );
}
