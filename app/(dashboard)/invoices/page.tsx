import { Icon } from "@/components/icons";
import { InvoiceListRow } from "@/components/invoice-row";
import { TabLinks } from "@/components/tabs";
import {
  EmptyRow,
  PageBody,
  Pager,
  SearchForm,
  TableCard,
  TableHeader,
  TableTitle,
} from "@/components/ui";
import { count, firstParam, hrefWith, pageInfo, pageParam, pagerHrefs } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import {
  INVOICE_STATUS_TABS,
  listInvoices,
  type InvoiceStatusTab,
} from "@/lib/queries";

const PAGE_SIZE = 10;
const PATH = "/invoices";

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const params = await searchParams;
  const requested = firstParam(params.status) as InvoiceStatusTab;
  const tab = INVOICE_STATUS_TABS.includes(requested) ? requested : "All";
  const search = firstParam(params.q);
  const { org } = await requireSession();

  const { rows, total } = await listInvoices(org.id, {
    tab,
    search,
    page: pageParam(params.page),
    size: PAGE_SIZE,
  });
  const info = pageInfo(total, pageParam(params.page), PAGE_SIZE);
  const { prevHref, nextHref } = pagerHrefs(PATH, params, info);

  return (
    <PageBody>
      <div className="flex flex-col items-center gap-[10px] rounded-[22px] border-[1.5px] border-dashed border-[#c8cdc0] bg-surface p-7 text-center">
        <span className="flex size-[42px] items-center justify-center rounded-[13px] bg-ok-bg text-ok-fg">
          <Icon name="upload" size={21} />
        </span>
        <span className="text-[15px] font-semibold">Drop any invoice, bill, or receipt</span>
        <span className="max-w-[440px] text-[12.5px] leading-[1.55] text-muted">
          PDF, scanned image, or email forward. Telecom, utilities, dining, subscriptions — line
          items, recurring charges, and credits are extracted automatically.
        </span>
        <button
          type="button"
          className="mt-1 cursor-pointer rounded-full bg-ink px-[18px] py-[9px] text-[12.5px] font-semibold text-bg"
        >
          Choose files
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-[9px]">
        <SearchForm
          action={PATH}
          placeholder="Search vendor, account, amount…"
          defaultValue={search}
          keep={{ status: tab === "All" ? undefined : tab }}
          className="max-w-[340px] flex-1"
        />
        <TabLinks
          options={INVOICE_STATUS_TABS}
          value={tab}
          label="Invoice status"
          href={(option) =>
            hrefWith(PATH, params, { status: option === "All" ? null : option, page: null })
          }
        />
      </div>

      <TableCard>
        <TableHeader>
          <TableTitle>{search ? `Invoices matching “${search}”` : "All invoices"}</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">{count(total)} documents</span>
          <button type="button" className="ml-auto cursor-pointer text-[11.5px] font-medium underline">
            Export CSV
          </button>
        </TableHeader>

        {rows.length === 0 ? (
          <EmptyRow>
            {search ? `Nothing matched “${search}”.` : "No invoices with this status."}
          </EmptyRow>
        ) : (
          rows.map((row) => <InvoiceListRow key={row.id} row={row} showPages />)
        )}

        <Pager
          label={`${count(info.from)}–${count(info.to)} of ${count(info.total)}`}
          prevHref={prevHref}
          nextHref={nextHref}
        />
      </TableCard>
    </PageBody>
  );
}
