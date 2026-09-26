"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { InvoiceListRow } from "@/components/invoice-row";
import { TabList } from "@/components/tabs";
import { PageBody, Pager, SearchBox, TableCard, TableHeader, TableTitle } from "@/components/ui";
import {
  INVOICE_STATUS_TABS,
  invoicePage,
  type InvoiceStatusTab,
} from "@/lib/data";

const PAGE_SIZE = 10;

export default function InvoicesPage() {
  const [tab, setTab] = useState<InvoiceStatusTab>("All");
  const [page, setPage] = useState(0);

  const slice = useMemo(() => invoicePage(tab, page, PAGE_SIZE), [tab, page]);

  function selectTab(next: InvoiceStatusTab) {
    setTab(next);
    setPage(0);
  }

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
        <SearchBox placeholder="Search vendor, account, amount…" className="max-w-[340px] flex-1" />
        <TabList
          options={INVOICE_STATUS_TABS}
          value={tab}
          onChange={selectTab}
          label="Invoice status"
        />
      </div>

      <TableCard>
        <TableHeader>
          <TableTitle>All invoices</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {slice.total.toLocaleString("en-US")} documents
          </span>
          <button type="button" className="ml-auto cursor-pointer text-[11.5px] font-medium underline">
            Export CSV
          </button>
        </TableHeader>

        {slice.rows.map((row, i) => (
          <InvoiceListRow key={`${slice.indices[i]}`} row={row} showPages />
        ))}

        <Pager
          label={`${slice.from.toLocaleString("en-US")}–${slice.to.toLocaleString("en-US")} of ${slice.total.toLocaleString("en-US")}`}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => Math.min(slice.pages - 1, p + 1))}
          disablePrev={slice.page === 0}
          disableNext={slice.page >= slice.pages - 1}
        />
      </TableCard>
    </PageBody>
  );
}
