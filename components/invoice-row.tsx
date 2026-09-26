import Link from "next/link";
import { CategoryTile, Pill } from "@/components/ui";
import { slugify, type InvoiceRow } from "@/lib/data";

export function InvoiceListRow({
  row,
  showPages = false,
}: {
  row: InvoiceRow;
  showPages?: boolean;
}) {
  return (
    <Link
      href={`/invoices/${slugify(row.vendor)}`}
      className="flex min-h-[60px] min-w-0 items-center gap-3 border-t border-line-soft px-[18px] py-3 hover:bg-[#fafbf9]"
    >
      <CategoryTile category={row.category} />
      <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
        <span className="truncate text-[13px] font-semibold">{row.vendor}</span>
        <span className="text-[11px] text-muted">
          {row.category} · {row.date}
          {showPages ? ` · ${row.pages}` : ""}
        </span>
      </div>
      <Pill tone={row.tone}>{row.status}</Pill>
      <span className="ml-2 shrink-0 font-mono text-[12.5px] font-medium">{row.amount}</span>
    </Link>
  );
}
