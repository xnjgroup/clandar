import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { Card, CardTitle, EmptyRow, IconTile, PageBody, Pill, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { relativeTime, type Tone } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { formatSchedule, getScheduledTask, listRuns } from "@/lib/scheduled-tasks";
import { ChangeSchedule } from "./change-schedule";
import { removeScheduledTask, runScheduledTaskNow, toggleScheduledTask } from "../actions";

const STATUS_TONE: Record<string, Tone> = { running: "warn", completed: "ok", failed: "bad" };

export default async function ScheduledTaskDetailPage({ params }: PageProps<"/tasks/scheduled/[id]">) {
  const { id } = await params;
  const { org } = await requireSession();
  const task = await getScheduledTask(id, org.id);
  if (!task) notFound();

  const runs = await listRuns(task.id);

  return (
    <PageBody>
      <Link href="/tasks/scheduled" className="text-[11.5px] font-medium underline">
        ← Automations
      </Link>

      <Card className="flex flex-col gap-[13px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <IconTile icon={task.icon} bg="#f2f4ef" fg="#4c4f47" />
          <div className="flex min-w-0 flex-col">
            <CardTitle>{task.name}</CardTitle>
            <span className="text-[11.5px] text-muted">{task.description}</span>
          </div>
          <Pill tone={task.isEnabled ? "ok" : "idle"}>{task.isEnabled ? "Enabled" : "Paused"}</Pill>
        </div>

        <p className="m-0 rounded-[12px] bg-bg px-3 py-[9px] text-[12.5px] leading-[1.55] text-body-soft">
          {task.prompt}
        </p>

        <div className="flex flex-wrap items-center gap-[14px] text-[11.5px] text-muted">
          <span className="flex items-center gap-[5px]">
            <Icon name="clock" size={13} />
            {formatSchedule(task.frequency, task.runTime, task.runWeekday)}
          </span>
          <span>
            Next run{" "}
            {task.nextRunAt.toLocaleString("en-US", {
              timeZone: task.timeZone,
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <ChangeSchedule id={task.id} frequency={task.frequency} runTime={task.runTime} runWeekday={task.runWeekday} />
          {task.lastRunAt ? <span>Last ran {relativeTime(task.lastRunAt)}</span> : null}
        </div>

        <div className="flex flex-wrap items-center gap-[10px] border-t border-line-soft pt-[12px]">
          <form action={runScheduledTaskNow}>
            <input type="hidden" name="id" value={task.id} />
            <button
              type="submit"
              className="cursor-pointer rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg"
            >
              Run now
            </button>
          </form>
          <form action={toggleScheduledTask}>
            <input type="hidden" name="id" value={task.id} />
            <input type="hidden" name="enabled" value={String(!task.isEnabled)} />
            <button
              type="submit"
              className="cursor-pointer rounded-full border border-line px-4 py-[9px] text-[12.5px] font-medium"
            >
              {task.isEnabled ? "Pause" : "Enable"}
            </button>
          </form>
          <form action={removeScheduledTask} className="ml-auto">
            <input type="hidden" name="id" value={task.id} />
            <button type="submit" className="cursor-pointer text-[11.5px] font-medium text-bad-fg underline">
              Delete
            </button>
          </form>
        </div>
      </Card>

      <TableCard>
        <TableHeader>
          <TableTitle>Run history</TableTitle>
        </TableHeader>
        {runs.length === 0 ? (
          <EmptyRow>No runs yet — click &ldquo;Run now&rdquo; to try it, or wait for its schedule.</EmptyRow>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="flex flex-col gap-[8px] border-t border-line-soft px-[18px] py-[13px]">
              <div className="flex flex-wrap items-center gap-[9px]">
                <Pill tone={STATUS_TONE[run.status]}>{run.status}</Pill>
                <span className="text-[11px] text-faint">{relativeTime(run.startedAt)}</span>
              </div>
              {run.output ? (
                <p className="m-0 whitespace-pre-wrap text-[12.5px] leading-[1.6] text-body">{run.output}</p>
              ) : run.error ? (
                <p className="m-0 text-[12px] leading-[1.5] text-bad-fg">{run.error}</p>
              ) : null}
            </div>
          ))
        )}
      </TableCard>
    </PageBody>
  );
}
