import Link from "next/link";
import { Icon } from "@/components/icons";
import { Card, EmptyRow, PageBody, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { firstParam, hrefWith } from "@/lib/data";
import { listTeam, requireSession } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { listUpcomingReminders } from "@/lib/reminders";
import { listSchedule } from "@/lib/schedule";
import { formatSchedule, listScheduledTasks } from "@/lib/scheduled-tasks";
import { REPEATS } from "@/lib/task-kinds";
import { AddToScheduleDialog } from "./add-to-schedule-dialog";
import { ScheduleList } from "./schedule-list";

export default async function SchedulePage({ searchParams }: PageProps<"/schedule">) {
  const params = await searchParams;
  const assignedTo = firstParam(params.who);
  const { org } = await requireSession();

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 30);

  const [team, projects, entries, reminders, automations] = await Promise.all([
    listTeam(org.id),
    listProjects(org.id),
    listSchedule(org.id, { from, to }, assignedTo ? { assignedTo } : {}),
    listUpcomingReminders(org.id, to, assignedTo ? { assignedTo } : {}),
    listScheduledTasks(org.id),
  ]);
  const activeAutomations = automations.filter((a) => a.isEnabled);

  return (
    <PageBody>
      <div className="flex items-center gap-[10px]">
        <AddToScheduleDialog
          projects={projects.map((j) => ({ id: j.id, title: `${j.title} — ${j.customerName}` }))}
          members={team}
          redirectPath="/schedule"
        />
      </div>

      <div className="-mx-[14px] flex gap-[7px] overflow-x-auto px-[14px] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        <Link
          href={hrefWith("/schedule", params, { who: null })}
          className={`shrink-0 rounded-full px-[14px] py-[8px] text-[12.5px] font-medium ${
            !assignedTo ? "bg-ink text-bg" : "border border-line bg-surface text-body"
          }`}
        >
          Everyone
        </Link>
        {team.map((m) => (
          <Link
            key={m.id}
            href={hrefWith("/schedule", params, { who: m.id })}
            className={`shrink-0 rounded-full px-[14px] py-[8px] text-[12.5px] font-medium ${
              assignedTo === m.id ? "bg-ink text-bg" : "border border-line bg-surface text-body"
            }`}
          >
            {m.name}
          </Link>
        ))}
      </div>

      <TableCard>
        <TableHeader>
          <TableTitle>Next 30 days</TableTitle>
        </TableHeader>
        <ScheduleList entries={entries} redirectPath="/schedule" />
      </TableCard>

      <TableCard>
        <TableHeader>
          <TableTitle>Upcoming reminders</TableTitle>
          <Link href="/tasks?kind=reminder" className="ml-auto text-[11.5px] font-medium underline">
            All reminders
          </Link>
        </TableHeader>
        {reminders.length === 0 ? (
          <EmptyRow>No reminders due in the next 30 days.</EmptyRow>
        ) : (
          reminders.map((r) => (
            <div key={r.id} className="flex min-h-[52px] flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[10px]">
              <Icon name="clock" size={15} className={`shrink-0 ${r.overdue ? "text-bad-fg" : "text-body-soft"}`} />
              {/* Shown in the reminder's own zone — the one it fires in. */}
              <span className={`w-[150px] shrink-0 font-mono text-[11.5px] ${r.overdue ? "font-semibold text-bad-fg" : "text-muted"}`}>
                {r.dueAt.toLocaleString("en-US", {
                  timeZone: r.timeZone,
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
                <Link href={`/tasks/${r.id}`} className="truncate text-[13px] font-semibold hover:underline">
                  {r.title}
                </Link>
                <span className="truncate text-[11px] text-muted">
                  {[
                    r.overdue ? "Overdue" : null,
                    r.repeat !== "none" ? REPEATS.find((x) => x.id === r.repeat)?.label : null,
                    r.projectTitle,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {r.assignedName ? (
                <span className="flex shrink-0 items-center gap-[5px] rounded-full border border-line px-[9px] py-[4px] text-[11px] text-body-soft">
                  <Icon name="user" size={12} />
                  {r.assignedName}
                </span>
              ) : null}
            </div>
          ))
        )}
      </TableCard>

      {/* Automations (AI jobs on a timer) live under /tasks/scheduled — surfaced here too, since "schedule" is where people look. */}
      <Card className="flex flex-col gap-[12px] sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-[12px]">
          <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[12px] bg-lime">
            <Icon name="bot" size={18} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="text-[13.5px] font-semibold">Automations</span>
            {activeAutomations.length > 0 ? (
              <span className="flex flex-col gap-[2px] text-[12px] text-muted">
                {activeAutomations.slice(0, 3).map((a) => (
                  <span key={a.id} className="truncate">
                    <span className="font-medium text-ink">{a.name}</span> ·{" "}
                    {formatSchedule(a.frequency, a.runTime, a.runWeekday)}
                  </span>
                ))}
                {activeAutomations.length > 3 ? <span>+{activeAutomations.length - 3} more</span> : null}
              </span>
            ) : (
              <span className="text-[12px] text-muted">
                Let AI handle recurring work — a daily briefing every morning, a weekly review on Friday, inbox triage.
              </span>
            )}
          </div>
        </div>
        <Link
          href="/tasks/scheduled"
          className="flex h-[38px] shrink-0 items-center justify-center rounded-full border border-line px-4 text-[12.5px] font-semibold"
        >
          {activeAutomations.length > 0 ? "Manage automations" : "Set up automations"}
        </Link>
      </Card>

    </PageBody>
  );
}
