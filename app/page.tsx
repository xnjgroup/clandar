import Link from "next/link";
import { Icon } from "@/components/icons";
import { SpendByCategoryChart } from "@/components/charts";
import { InvoiceListRow } from "@/components/invoice-row";
import { Card, CardTitle, PageBody, StatCard, StatRow, TableCard } from "@/components/ui";
import { NEEDS_ATTENTION, OVERVIEW_STATS, RECENT_INVOICES } from "@/lib/data";

export default function OverviewPage() {
  return (
    <PageBody>
      <StatRow>
        {OVERVIEW_STATS.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </StatRow>

      <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <Card className="flex flex-col gap-[13px]">
          <div className="flex flex-wrap items-center gap-[10px]">
            <CardTitle>Spend by category</CardTitle>
            <span className="ml-auto font-mono text-[10.5px] text-faint">This month</span>
          </div>
          <SpendByCategoryChart />
        </Card>

        <Card className="flex flex-col gap-[13px]">
          <div className="flex items-center gap-[10px]">
            <CardTitle>Needs attention</CardTitle>
            <span className="ml-auto shrink-0 rounded-full bg-bad-bg px-[9px] py-1 font-mono text-[10.5px] text-bad-fg">
              3 open
            </span>
          </div>

          {NEEDS_ATTENTION.map((a) => {
            const high = a.severity === "high";
            return (
              <Link
                key={a.title}
                href={a.href}
                className="group flex min-w-0 items-stretch gap-[10px]"
              >
                <span
                  className={`w-[3px] shrink-0 self-stretch rounded-[3px] ${
                    high ? "bg-meter-bad" : "bg-meter-warn"
                  }`}
                />
                <span
                  className={`flex size-[34px] shrink-0 items-center justify-center rounded-[12px] ${
                    high ? "bg-bad-bg text-bad-fg" : "bg-warn-bg text-warn-fg"
                  }`}
                >
                  <Icon name={a.icon} size={16} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[3px] py-px">
                  <span className="flex min-w-0 items-start gap-[10px]">
                    <span className="min-w-0 flex-1 text-[12.5px] leading-[1.35] font-semibold">
                      {a.title}
                    </span>
                    <span className="shrink-0 text-[11.5px] font-medium underline">
                      {high ? "Review" : "Open"}
                    </span>
                  </span>
                  <span className="text-[11px] leading-[1.45] text-muted">{a.note}</span>
                </span>
              </Link>
            );
          })}
        </Card>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <TableCard>
          <div className="flex items-center gap-[10px] px-[18px] py-4">
            <CardTitle>Recent invoices</CardTitle>
            <Link href="/invoices" className="ml-auto text-[12.5px] font-medium underline">
              See all
            </Link>
          </div>
          {RECENT_INVOICES.map((row) => (
            <InvoiceListRow key={row.vendor} row={row} />
          ))}
        </TableCard>

        <div className="flex min-w-0 flex-col gap-3 rounded-[22px] bg-lime p-[18px]">
          <div className="flex items-center gap-[10px]">
            <Icon name="bot" size={18} />
            <CardTitle>Expense agent</CardTitle>
          </div>
          <p className="m-0 text-[12.5px] leading-[1.55] text-[#3f4b28]">
            &ldquo;You&rsquo;re 88% through the Utilities budget with 9 days left in the month —
            Comcast jumped 14% from last cycle.&rdquo;
          </p>
          <Link
            href="/messages"
            className="rounded-full bg-ink px-[15px] py-[9px] text-center text-[12.5px] font-semibold text-bg"
          >
            Ask about this
          </Link>
        </div>
      </div>
    </PageBody>
  );
}
