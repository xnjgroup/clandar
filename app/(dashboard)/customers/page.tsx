import Link from "next/link";
import { HeaderActions } from "@/components/header-actions";
import { EmptyRow, IconTile, PageBody, SearchForm, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { firstParam } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { listCustomers } from "@/lib/customers";
import { NewCustomerDialog } from "./add-customer-form";

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const { org } = await requireSession();
  const search = firstParam((await searchParams).q);
  const customers = await listCustomers(org.id, search || undefined);

  return (
    <PageBody>
      <HeaderActions>
        <NewCustomerDialog />
      </HeaderActions>

      <SearchForm action="/customers" placeholder="Search customers — name, email, phone…" defaultValue={search} />

      <TableCard>
        <TableHeader>
          <TableTitle>{search ? "Matching customers" : "All customers"}</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">{customers.length}</span>
        </TableHeader>
        {customers.length === 0 ? (
          <EmptyRow>
            {search ? `No customers matched "${search}".` : "No customers yet — add your first one with the + above."}
          </EmptyRow>
        ) : (
          customers.map((c) => (
            <Link
              key={c.id}
              href={`/customers/${c.id}`}
              className="flex min-h-[64px] min-w-0 items-center gap-3 border-t border-line-soft px-[18px] py-[13px] hover:bg-[#fafbf9]"
            >
              <IconTile icon="user" bg="#f2f4ef" fg="#4c4f47" />
              <div className="flex min-w-0 flex-1 flex-col leading-[1.4]">
                <span className="truncate text-[13.5px] font-semibold">{c.name}</span>
                <span className="truncate text-[11.5px] text-muted">
                  {[c.phone, c.email].filter(Boolean).join(" · ") || "No contact info yet"}
                </span>
                {c.address ? <span className="truncate text-[11px] text-faint">{c.address}</span> : null}
              </div>
              <span className="shrink-0 font-mono text-[11px] text-faint">
                {c.projectCount} project{c.projectCount === 1 ? "" : "s"}
              </span>
            </Link>
          ))
        )}
      </TableCard>
    </PageBody>
  );
}
