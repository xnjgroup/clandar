import Link from "next/link";
import {
  DataTable,
  EmptyRow,
  PageBody,
  TableCard,
  TableHeader,
  TableTitle,
  type Column,
} from "@/components/ui";
import { money0 } from "@/lib/data";
import { vendorDirectory } from "@/lib/queries";

const COLUMNS: Column[] = [
  { label: "Vendor", track: "minmax(140px,1.8fr)" },
  { label: "Category", track: "minmax(110px,1.1fr)", mono: true },
  { label: "Monthly avg", track: "minmax(90px,1fr)", align: "right" },
  { label: "Invoices", track: "minmax(70px,0.7fr)", align: "right" },
  { label: "Since", track: "minmax(90px,1fr)" },
];

export default async function VendorsPage() {
  const vendors = await vendorDirectory();

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

        {vendors.length === 0 ? (
          <EmptyRow>No vendors yet.</EmptyRow>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={vendors.map((v) => [
              <Link key={v.slug} href={`/invoices/${v.slug}`} className="underline">
                {v.vendor}
              </Link>,
              v.category,
              `${money0(v.monthlyAvg)}/mo`,
              String(v.invoices),
              v.since
                ? new Date(`${v.since}T00:00:00`).toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                  })
                : "—",
            ])}
          />
        )}
      </TableCard>
    </PageBody>
  );
}
