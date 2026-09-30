import Link from "next/link";
import { Icon } from "@/components/icons";
import { SpendByCategoryChart } from "@/components/charts";
import { InvoiceListRow } from "@/components/invoice-row";
import { OpenAssistantButton } from "@/components/open-assistant-button";
import { Card, CardTitle, EmptyRow, PageBody, Pill, StatCard, StatRow, TableCard } from "@/components/ui";
import { count, delta, money0 } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { PROJECT_STATUSES, describeDue, listProjects, projectOverview } from "@/lib/projects";
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
  const [projectStats, activeProjects, stats, slices, attention, invoices] = await Promise.all([
    projectOverview(org.id),
    listProjects(org.id),
    overviewStats(org.id),
    spendByCategory(org.id),
    needsAttention(org.id),
    recentInvoices(org.id, 5),
  ]);

  const projectCards = [
    {
      label: "Active projects",
      value: count(projectStats.active),
      sub: projectStats.activeOverdue ? `${count(projectStats.activeOverdue)} past due` : "scheduled or in progress",
    },
    {
      label: "Pipeline",
      value: count(projectStats.leads + projectStats.quoted),
      sub: `${count(projectStats.leads)} lead${projectStats.leads === 1 ? "" : "s"} · ${money0(projectStats.quotesOut)} quoted out`,
    },
    {
      label: "Tasks due today",
      value: count(projectStats.tasksToday),
      sub: projectStats.tasksOverdue ? `${count(projectStats.tasksOverdue)} overdue` : "nothing overdue",
    },
    {
      label: "Jobs this week",
      value: count(projectStats.jobsThisWeek),
      sub: projectStats.newLeads ? `${count(projectStats.newLeads)} new email lead${projectStats.newLeads === 1 ? "" : "s"}` : "on the schedule",
    },
  ];
  // Jobs underway first, soonest due first; anything without a due date after.
  const current = activeProjects
    .filter((p) => p.status === "scheduled" || p.status === "in_progress")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .slice(0, 6);

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
        {projectCards.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </StatRow>

      <TableCard>
        <div className="flex items-center gap-[10px] px-[18px] py-4">
          <CardTitle>Active projects</CardTitle>
          <Link href="/projects" className="ml-auto text-[12.5px] font-medium underline">
            All projects
          </Link>
        </div>
        {current.length === 0 ? (
          <EmptyRow>No projects scheduled or in progress.</EmptyRow>
        ) : (
          current.map((p) => {
            const due = describeDue(p.dueDate, p.status);
            const pct = p.taskCount ? Math.round((p.tasksDone / p.taskCount) * 100) : null;
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="flex min-h-[58px] min-w-0 flex-wrap items-center gap-x-3 gap-y-[6px] border-t border-line-soft px-[18px] py-[11px] hover:bg-[#fafbf9]"
              >
                <div className="flex min-w-0 flex-1 basis-[200px] flex-col leading-[1.4]">
                  <span className="truncate text-[13px] font-semibold">{p.title}</span>
                  <span className="truncate text-[11.5px] text-muted">
                    {p.customerName}
                    {due ? <span className={due.overdue ? "font-medium text-bad-fg" : ""}> · {due.label}</span> : null}
                  </span>
                </div>
                <span className="flex w-[130px] shrink-0 items-center gap-[8px]" title={pct === null ? "No tasks" : `${p.tasksDone} of ${p.taskCount} tasks done`}>
                  {pct === null ? (
                    <span className="text-[11px] text-faint">No tasks</span>
                  ) : (
                    <>
                      <span className="h-[6px] flex-1 overflow-hidden rounded-full bg-line-soft">
                        <span className={`block h-full rounded-full ${pct === 100 ? "bg-ok-fg" : "bg-ink"}`} style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-[34px] text-right font-mono text-[11px] font-semibold">{pct}%</span>
                    </>
                  )}
                </span>
                <Pill tone={p.status === "in_progress" ? "ok" : "warn"}>
                  {PROJECT_STATUSES.find((s) => s.id === p.status)?.label ?? p.status}
                </Pill>
              </Link>
            );
          })
        )}
      </TableCard>

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
                className="cursor-pointer rounded-full bg-ink px-[15px] py-[9px] text-left text-[12.5px] font-semibold text-bg hover:bg-ink/85"
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
