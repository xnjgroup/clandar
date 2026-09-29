import Link from "next/link";
import { Icon } from "@/components/icons";
import { Card, CardTitle, EmptyRow, PageBody, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { firstParam, hrefWith } from "@/lib/data";
import { listTeam, requireSession } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { listUpcomingReminders } from "@/lib/reminders";
import { listSchedule } from "@/lib/schedule";
import { REPEATS } from "@/lib/task-kinds";
import { removeScheduleEntry } from "./actions";
import { ScheduleForm } from "./schedule-form";

export default async function SchedulePage({ searchParams }: PageProps<"/schedule">) {
  const params = await searchParams;
  const assignedTo = firstParam(params.who);
  const { org } = await requireSession();

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 30);

  const [team, projects, entries, reminders] = await Promise.all([
    listTeam(org.id),
    listProjects(org.id),
    listSchedule(org.id, { from, to }, assignedTo ? { assignedTo } : {}),
    listUpcomingReminders(org.id, to, assignedTo ? { assignedTo } : {}),
  ]);

  const days = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = entry.startsAt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    days.set(key, [...(days.get(key) ?? []), entry]);
  }

  return (
    <PageBody>
      <Card className="flex flex-col gap-[13px]">
        <CardTitle>Schedule a project</CardTitle>
        <ScheduleForm
          projects={projects.map((j) => ({ id: j.id, title: `${j.title} — ${j.customerName}` }))}
          members={team}
          redirectPath="/schedule"
        />
      </Card>

      <div className="flex flex-wrap gap-[7px]">
        <Link
          href={hrefWith("/schedule", params, { who: null })}
          className={`rounded-full px-[14px] py-[8px] text-[12.5px] font-medium ${
            !assignedTo ? "bg-ink text-bg" : "border border-line bg-surface text-body"
          }`}
        >
          Everyone
        </Link>
        {team.map((m) => (
          <Link
            key={m.id}
            href={hrefWith("/schedule", params, { who: m.id })}
            className={`rounded-full px-[14px] py-[8px] text-[12.5px] font-medium ${
              assignedTo === m.id ? "bg-ink text-bg" : "border border-line bg-surface text-body"
            }`}
          >
            {m.name}
          </Link>
        ))}
      </div>

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

      <TableCard>
        <TableHeader>
          <TableTitle>Next 30 days</TableTitle>
        </TableHeader>
        {entries.length === 0 ? (
          <EmptyRow>Nothing scheduled in the next 30 days.</EmptyRow>
        ) : (
          Array.from(days.entries()).map(([day, dayEntries]) => (
            <div key={day} className="border-t border-line-soft">
              <div className="bg-[#fafbf9] px-[18px] py-[8px] text-[11.5px] font-semibold text-body-soft">{day}</div>
              {dayEntries.map((entry) => (
                <div key={entry.id} className="flex min-h-[56px] flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[11px]">
                  <span className="font-mono text-[11.5px] text-muted">
                    {entry.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} –{" "}
                    {entry.endsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </span>
                  <Link href={`/projects/${entry.projectId}`} className="min-w-0 flex-1 truncate text-[13px] font-semibold underline">
                    {entry.projectTitle}
                  </Link>
                  <span className="truncate text-[11.5px] text-muted">{entry.customerName}</span>
                  {entry.assignedName ? (
                    <span className="flex shrink-0 items-center gap-[5px] rounded-full border border-line px-[9px] py-[4px] text-[11px] text-body-soft">
                      <Icon name="user" size={12} />
                      {entry.assignedName}
                    </span>
                  ) : null}
                  <form action={removeScheduleEntry}>
                    <input type="hidden" name="id" value={entry.id} />
                    <input type="hidden" name="redirectPath" value="/schedule" />
                    <button type="submit" aria-label="Remove" className="cursor-pointer text-faint hover:text-bad-fg">
                      <Icon name="close" size={14} />
                    </button>
                  </form>
                </div>
              ))}
            </div>
          ))
        )}
      </TableCard>
    </PageBody>
  );
}
