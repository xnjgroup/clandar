import Link from "next/link";
import {
  DataTable,
  PageBody,
  TableCard,
  TableHeader,
  TableTitle,
  type Column,
} from "@/components/ui";
import { VENDOR_DIRECTORY } from "@/lib/data";

const COLUMNS: Column[] = [
  { label: "Vendor", track: "minmax(140px,1.8fr)" },
  { label: "Category", track: "minmax(110px,1.1fr)", mono: true },
  { label: "Monthly avg", track: "minmax(90px,1fr)", align: "right" },
  { label: "Since", track: "minmax(90px,1fr)" },
];

export default function VendorsPage() {
  return (
    <PageBody>
      <TableCard>
        <TableHeader>
          <TableTitle>Vendors &amp; accounts</TableTitle>
          <Link href="/assets" className="text-[11.5px] font-medium underline">
            View assets
          </Link>
          <Link href="/locations" className="text-[11.5px] font-medium underline">
            View locations
          </Link>
          <button
            type="button"
            className="ml-auto cursor-pointer rounded-full bg-ink px-[15px] py-2 text-[12.5px] font-semibold text-bg"
          >
            Add vendor
          </button>
        </TableHeader>

        <DataTable
          columns={COLUMNS}
          rows={VENDOR_DIRECTORY.map((v) => [v.vendor, v.category, v.monthlyAvg, v.since])}
        />
      </TableCard>
    </PageBody>
  );
}
