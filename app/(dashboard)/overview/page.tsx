import Link from "next/link";
import { Icon } from "@/components/icons";
import { SpendByCategoryChart } from "@/components/charts";
import { InvoiceListRow } from "@/components/invoice-row";
import { OpenAssistantButton } from "@/components/open-assistant-button";
import { Card, CardTitle, EmptyRow, PageBody, StatCard, StatRow, TableCard } from "@/components/ui";
import { count, delta, money0 } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import {
  needsAttention,
  overviewStats,
  recentInvoices,
  spendByCategory,
} from "@/lib/queries";

/** One-tap questions on the assistant card — each opens the chat and asks it in a fresh conversation. */
const QUICK_QUESTIONS = [
  "What's the project status today?",
  "Any to-do items today?",
  "What's on the schedule this week?",
  "Any invoices waiting for review?",
];

export default async function OverviewPage() {
  const { org } = await requireSession();
  const [stats, slices, attention, invoices] = await Promise.all([
    overviewStats(org.id),
    spendByCategory(org.id),
    needsAttention(org.id),
    recentInvoices(org.id, 5),
  ]);

  const cards = [
    {
      label: "Spend this month",
      value: money0(stats.monthTotal),
      sub: `${delta(stats.monthTotal, stats.lastMonthTotal)} vs last month`,
    },
    {
      label: "Pending approval",
      value: money0(stats.pendingTotal),
      sub: `${count(stats.pendingCount)} invoice${stats.pendingCount === 1 ? "" : "s"} waiting`,
    },
    {
      label: "Flagged",
      value: count(stats.flaggedCount),
      sub: `${count(stats.openFraudCount)} open risk flag${stats.openFraudCount === 1 ? "" : "s"}`,
    },
    {
      label: "Recurring monthly",
      value: money0(stats.recurringTotal),
      sub: `across ${count(stats.recurringVendors)} vendors`,
    },
  ];

  return (
    <PageBody>
      <StatRow>
        {cards.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </StatRow>

      <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <Card className="flex flex-col gap-[13px]">
          <div className="flex flex-wrap items-center gap-[10px]">
            <CardTitle>Spend by category</CardTitle>
            <span className="ml-auto font-mono text-[10.5px] text-faint">This month</span>
          </div>
          <SpendByCategoryChart slices={slices} />
        </Card>

        <Card className="flex flex-col gap-[13px]">
          <div className="flex items-center gap-[10px]">
            <CardTitle>Needs attention</CardTitle>
            <span className="ml-auto shrink-0 rounded-full bg-bad-bg px-[9px] py-1 font-mono text-[10.5px] text-bad-fg">
              {attention.length} open
            </span>
          </div>

          {attention.length === 0 ? (
            <span className="py-4 text-center text-[12.5px] text-muted">
              Nothing waiting — no open flags, reviews or approvals.
            </span>
          ) : null}

          {attention.map((a) => {
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
          {invoices.length === 0 ? (
            <EmptyRow>No invoices yet — upload one to get started.</EmptyRow>
          ) : (
            invoices.map((row) => <InvoiceListRow key={row.id} row={row} />)
          )}
        </TableCard>

        <div className="flex min-w-0 flex-col gap-3 rounded-[22px] bg-lime p-[18px]">
          <div className="flex items-center gap-[10px]">
            <Icon name="bot" size={18} />
            <CardTitle>Executive Assistant</CardTitle>
          </div>
          <div className="flex flex-col gap-[7px]">
            {QUICK_QUESTIONS.map((q) => (
              <OpenAssistantButton
                key={q}
                prompt={q}
                className="cursor-pointer rounded-[12px] bg-surface/70 px-[13px] py-[9px] text-left text-[12.5px] font-medium text-ink hover:bg-surface"
              >
                {q}
              </OpenAssistantButton>
            ))}
          </div>
        </div>
      </div>
    </PageBody>
  );
}
