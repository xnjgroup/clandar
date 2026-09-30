import Link from "next/link";
import { Icon } from "@/components/icons";
import { Card, EmptyRow, IconTile, PageBody, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { relativeTime } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { countOpenLeads, getLeadFinderSettings } from "@/lib/lead-finder";
import { formatSchedule, listScheduledTasks, TASK_PRESETS } from "@/lib/scheduled-tasks";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { removeScheduledTask, toggleScheduledTask } from "./actions";
import { AddScheduledTaskButton } from "./add-scheduled-task-button";
import { PresetAdder } from "./preset-adder";

export default async function ScheduledTasksPage() {
  const { org } = await requireSession();
  const [tasks, leadFinder, openLeads] = await Promise.all([
    listScheduledTasks(org.id),
    getLeadFinderSettings(org.id),
    countOpenLeads(org.id),
  ]);

  return (
    <PageBody>
      <div className="flex items-center gap-[10px]">
        <Link href="/schedule" className="text-[11.5px] font-medium underline">
          ← Schedule
        </Link>
        <Link href="/tasks" className="text-[11.5px] font-medium underline">
          Tasks
        </Link>
      </div>

      {/* Built-in: the lead finder has its own settings page rather than a prompt. */}
      <Link href="/tasks/scheduled/lead-finder" className="block">
        <Card className="flex flex-wrap items-center gap-[12px] hover:bg-[#fafbf9]">
          <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[12px] bg-lime">
            <Icon name="search" size={18} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[13.5px] font-semibold">Lead finder</span>
            <span className="text-[12px] text-muted">
              {leadFinder.isEnabled
                ? `Watching your email every ${leadFinder.checkMinutes} min for project requests${
                    openLeads ? ` · ${openLeads} new lead${openLeads === 1 ? "" : "s"} to review` : ""
                  }`
                : "Finds emails asking for work and sorts them by your project types — with a daily summary."}
            </span>
          </div>
          <span
            className={`shrink-0 rounded-full px-[12px] py-[6px] text-[11.5px] font-semibold ${
              leadFinder.isEnabled ? "bg-ok-bg text-ok-fg" : "bg-ink text-bg"
            }`}
          >
            {leadFinder.isEnabled ? "On · Settings" : "Set up"}
          </span>
        </Card>
      </Link>

      <Card>
        <AddScheduledTaskButton />
      </Card>

      <TableCard>
        <TableHeader>
          <TableTitle>Your automations</TableTitle>
          <span className="ml-auto font-mono text-[10.5px] text-faint">
            {tasks.length} automation{tasks.length === 1 ? "" : "s"}
          </span>
        </TableHeader>

        {tasks.length === 0 ? (
          <EmptyRow>No automations yet — add a ready-made one below, or create your own.</EmptyRow>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              className="flex min-h-[64px] min-w-0 flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[13px]"
            >
              <IconTile icon={task.icon} bg="#f2f4ef" fg="#4c4f47" />
              <Link href={`/tasks/scheduled/${task.id}`} className="flex min-w-0 flex-1 flex-col leading-[1.4]">
                <span className="truncate text-[13.5px] font-semibold underline">{task.name}</span>
                <span className="truncate text-[11.5px] text-muted">{task.description}</span>
                <span className="flex items-center gap-[5px] text-[11px] text-faint">
                  <Icon name="clock" size={11} />
                  {formatSchedule(task.frequency, task.runTime, task.runWeekday)}
                </span>
              </Link>
              {task.lastRunAt ? (
                <span className="hidden shrink-0 font-mono text-[11px] text-faint sm:inline">
                  last ran {relativeTime(task.lastRunAt)}
                </span>
              ) : null}
              <form action={toggleScheduledTask}>
                <input type="hidden" name="id" value={task.id} />
                <input type="hidden" name="enabled" value={String(!task.isEnabled)} />
                <button
                  type="submit"
                  className={`cursor-pointer rounded-full px-[12px] py-[6px] text-[11px] font-medium ${
                    task.isEnabled ? "bg-ok-bg text-ok-fg" : "bg-idle-bg text-idle-fg"
                  }`}
                >
                  {task.isEnabled ? "Enabled" : "Paused"}
                </button>
              </form>
              <ConfirmDeleteButton
                compact
                action={removeScheduledTask}
                fields={{ id: task.id }}
                title={`Delete “${task.name}”?`}
                message="It stops running and its run history is deleted too. This can't be undone."
              />
            </div>
          ))
        )}
      </TableCard>

      <TableCard>
        <TableHeader>
          <TableTitle>Ready-made automations</TableTitle>
        </TableHeader>
        <div className="grid grid-cols-1 gap-[1px] border-t border-line-soft bg-line-soft sm:grid-cols-2">
          {TASK_PRESETS.map((preset, i) => (
            <div key={preset.name} className="flex flex-col gap-[8px] bg-surface p-[16px]">
              <div className="flex items-center gap-[10px]">
                <IconTile icon={preset.icon} bg="#f2f4ef" fg="#4c4f47" />
                <span className="text-[13.5px] font-semibold">{preset.name}</span>
              </div>
              <p className="m-0 text-[12px] leading-[1.5] text-body-soft">{preset.description}</p>
              <span className="flex items-center gap-[5px] text-[11px] text-faint">
                <Icon name="clock" size={11} />
                {formatSchedule(preset.frequency, preset.runTime, preset.runWeekday)}
              </span>
              <PresetAdder index={i} frequency={preset.frequency} runTime={preset.runTime} runWeekday={preset.runWeekday} />
            </div>
          ))}
        </div>
      </TableCard>
    </PageBody>
  );
}
