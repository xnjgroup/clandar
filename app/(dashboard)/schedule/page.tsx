import Link from "next/link";
import { Icon } from "@/components/icons";
import { Card, CardTitle, EmptyRow, PageBody, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { firstParam, hrefWith } from "@/lib/data";
import { listTeam, requireSession } from "@/lib/auth";
import { listJobs } from "@/lib/jobs";
import { listSchedule } from "@/lib/schedule";
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

  const [team, jobs, entries] = await Promise.all([
    listTeam(org.id),
    listJobs(org.id),
    listSchedule(org.id, { from, to }, assignedTo ? { assignedTo } : {}),
  ]);

  const days = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = entry.startsAt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    days.set(key, [...(days.get(key) ?? []), entry]);
  }

  return (
    <PageBody>
      <Card className="flex flex-col gap-[13px]">
        <CardTitle>Schedule a job</CardTitle>
        <ScheduleForm
          jobs={jobs.map((j) => ({ id: j.id, title: `${j.title} — ${j.customerName}` }))}
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
                  <Link href={`/jobs/${entry.jobId}`} className="min-w-0 flex-1 truncate text-[13px] font-semibold underline">
                    {entry.jobTitle}
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
