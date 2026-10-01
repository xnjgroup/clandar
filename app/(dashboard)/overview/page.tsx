import Link from "next/link";
import { Icon } from "@/components/icons";
import { SpendByCategoryChart } from "@/components/charts";
import { InvoiceListRow } from "@/components/invoice-row";
import { OpenAssistantButton } from "@/components/open-assistant-button";
import { Card, CardTitle, EmptyRow, PageBody, Pill, StatCard, StatRow, TableCard } from "@/components/ui";
import { count, delta, money0 } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { DashboardGrid, type DashboardWidget } from "@/components/dashboard-grid";
import { getDashboardLayout, type Placement } from "@/lib/dashboard-layout";
import { saveOverviewLayout } from "./actions";
import { PROJECT_STATUSES, describeDue, listProjects, projectOverview } from "@/lib/projects";
import {
  needsAttention,
  overviewStats,
  recentInvoices,
  spendByCategory,
} from "@/lib/queries";

/**
 * One-tap asks on the assistant card — each opens the chat and sends its prompt in a fresh
 * conversation. Questions go as-is; actions carry a fuller prompt so the assistant asks for
 * what it needs instead of guessing.
 */
const QUICK_ASKS: { group: "Ask" | "Do"; label: string; prompt: string }[] = [
  { group: "Ask", label: "What's the project status today?", prompt: "What's the project status today?" },
  { group: "Ask", label: "Any to-do items today?", prompt: "Any to-do items today?" },
  { group: "Ask", label: "What's on the schedule this week?", prompt: "What's on the schedule this week?" },
  {
    group: "Do",
    label: "Create a project",
    prompt: "I want to create a new project. Ask me what it is, who it's for (if anyone) and anything else you need.",
  },
  { group: "Do", label: "Set a reminder", prompt: "Set a reminder for me. Ask me what it's for and when." },
  {
    group: "Do",
    label: "Plan a trip",
    prompt: "Help me plan a trip. Ask me where, when and what it's for, then write out a plan.",
  },
];

/** Where each widget starts (12-column grid, 30px rows) — also what "Reset layout" restores. */
const DEFAULT_LAYOUT: Placement[] = [
  { i: "project-stats", x: 0, y: 0, w: 12, h: 3, minW: 6, minH: 3 },
  { i: "active-projects", x: 0, y: 3, w: 8, h: 8, minW: 4, minH: 4 },
  { i: "assistant", x: 8, y: 3, w: 4, h: 8, minW: 3, minH: 6 },
  { i: "finance-stats", x: 0, y: 11, w: 12, h: 3, minW: 6, minH: 3 },
  { i: "spend", x: 0, y: 14, w: 6, h: 10, minW: 4, minH: 6 },
  { i: "attention", x: 6, y: 14, w: 6, h: 10, minW: 4, minH: 5 },
  { i: "invoices", x: 0, y: 24, w: 12, h: 9, minW: 4, minH: 4 },
];

export default async function OverviewPage() {
  const { org, person } = await requireSession();
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
      label: "Scheduled this week",
      value: count(projectStats.jobsThisWeek),
      sub: projectStats.newLeads ? `${count(projectStats.newLeads)} new email lead${projectStats.newLeads === 1 ? "" : "s"}` : "on the schedule",
    },
  ];
  // Jobs underway first, soonest due first; anything without a due date after.
  const current = activeProjects
    .filter((p) => p.status === "scheduled" || p.status === "in_progress")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .slice(0, 4);

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

  const widgets: DashboardWidget[] = [
    {
      id: "project-stats",
      title: "Project stats",
      node: (
        <StatRow>
                {projectCards.map((s) => (
                  <StatCard key={s.label} {...s} />
                ))}
              </StatRow>
      ),
    },
    {
      id: "active-projects",
      title: "Active projects",
      node: (
        <TableCard className="flex flex-col">
                <div className="flex shrink-0 items-center gap-[10px] px-[18px] py-[12px]">
                  <CardTitle>Active projects</CardTitle>
                  <Link href="/projects" className="ml-auto text-[12px] font-medium underline">
                    All projects
                  </Link>
                </div>
                {/* Only the rows scroll when the widget is shorter than its list. */}
                <div className="min-h-0 flex-1 overflow-y-auto">
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
                        className="flex min-w-0 items-center gap-3 border-t border-line-soft px-[18px] py-[8px] hover:bg-[#fafbf9]"
                      >
                        <span className="min-w-0 flex-1 truncate text-[12.5px]">
                          <span className="font-semibold">{p.title}</span>
                          <span className="text-muted"> · {p.customerName}</span>
                          {due ? <span className={due.overdue ? "font-medium text-bad-fg" : "text-faint"}> · {due.label}</span> : null}
                        </span>
                        {pct !== null ? (
                          <span className="hidden w-[64px] shrink-0 items-center gap-[5px] sm:flex" title={`${p.tasksDone} of ${p.taskCount} tasks done`}>
                            <span className="h-[4px] flex-1 overflow-hidden rounded-full bg-line-soft">
                              <span className={`block h-full rounded-full ${pct === 100 ? "bg-ok-fg" : "bg-ink"}`} style={{ width: `${pct}%` }} />
                            </span>
                            <span className="font-mono text-[10.5px] text-muted">{pct}%</span>
                          </span>
                        ) : null}
                        <Pill tone={p.status === "in_progress" ? "ok" : "warn"}>
                          {PROJECT_STATUSES.find((s) => s.id === p.status)?.label ?? p.status}
                        </Pill>
                      </Link>
                    );
                  })
                )}
                </div>
              </TableCard>
      ),
    },
    {
      id: "assistant",
      title: org.assistantName,
      node: (
        <div className="flex min-w-0 flex-col gap-3 overflow-y-auto rounded-[22px] bg-lime p-[18px]">
                <div className="flex items-center gap-[10px]">
                  <Icon name="bot" size={18} />
                  <CardTitle>{org.assistantName}</CardTitle>
                </div>
                {(["Ask", "Do"] as const).map((group) => (
                  <div key={group} className="flex flex-col gap-[6px]">
                    <span className="text-[10.5px] font-semibold tracking-[0.06em] text-[#3f4b28] uppercase">{group}</span>
                    <div className="flex flex-wrap gap-[6px]">
                      {QUICK_ASKS.filter((q) => q.group === group).map((q) => (
                        <OpenAssistantButton
                          key={q.label}
                          prompt={q.prompt}
                          className="cursor-pointer rounded-full bg-ink px-[13px] py-[7px] text-left text-[12px] font-semibold text-bg hover:bg-ink/85"
                        >
                          {q.label}
                        </OpenAssistantButton>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
      ),
    },
    {
      id: "finance-stats",
      title: "Spending stats",
      node: (
        <StatRow>
                {cards.map((s) => (
                  <StatCard key={s.label} {...s} />
                ))}
              </StatRow>
      ),
    },
    {
      id: "spend",
      title: "Spend by category",
      node: (
        <Card className="flex flex-col gap-[13px]">
                <div className="flex shrink-0 flex-wrap items-center gap-[10px]">
                  <CardTitle>Spend by category</CardTitle>
                  <span className="ml-auto font-mono text-[10.5px] text-faint">This month</span>
                </div>
                {/* Clipped: the chart library can draw a few px wider than its box after a resize. */}
                <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                  <SpendByCategoryChart slices={slices} />
                </div>
              </Card>
      ),
    },
    {
      id: "attention",
      title: "Needs attention",
      node: (
        <Card className="flex flex-col gap-[13px]">
                <div className="flex shrink-0 items-center gap-[10px]">
                  <CardTitle>Needs attention</CardTitle>
                  <span className="ml-auto shrink-0 rounded-full bg-bad-bg px-[9px] py-1 font-mono text-[10.5px] text-bad-fg">
                    {attention.length} open
                  </span>
                </div>

                <div className="-mx-[4px] flex min-h-0 flex-1 flex-col gap-[13px] overflow-y-auto px-[4px]">
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
                </div>
              </Card>
      ),
    },
    {
      id: "invoices",
      title: "Recent invoices",
      node: (
        <TableCard className="flex flex-col">
                <div className="flex shrink-0 items-center gap-[10px] px-[18px] py-4">
                  <CardTitle>Recent invoices</CardTitle>
                  <Link href="/invoices" className="ml-auto text-[12.5px] font-medium underline">
                    See all
                  </Link>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {invoices.length === 0 ? (
                    <EmptyRow>No invoices yet — upload one to get started.</EmptyRow>
                  ) : (
                    invoices.map((row) => <InvoiceListRow key={row.id} row={row} />)
                  )}
                </div>
              </TableCard>
      ),
    },
  ];
  const layout = await getDashboardLayout(person.id, "overview", DEFAULT_LAYOUT);

  return (
    <PageBody>
      <DashboardGrid widgets={widgets} layout={layout} defaultLayout={DEFAULT_LAYOUT} onSave={saveOverviewLayout} />
    </PageBody>
  );
}
