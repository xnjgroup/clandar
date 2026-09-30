import Link from "next/link";
import { Icon } from "@/components/icons";
import { EmptyRow } from "@/components/ui";
import { money, shortDate } from "@/lib/data";
import { REPEATS } from "@/lib/task-kinds";
import type { Task } from "@/lib/tasks";
import { removeTask, toggleTask } from "./actions";

// Not "check2" for to-dos — beside the done checkbox it reads as a stray checkmark.
const KIND_ICON = { todo: "clipboard", shopping: "card", reminder: "clock" } as const;

/** "today" / "tomorrow" / "in 5 days" / "overdue 2 days" for a YYYY-MM-DD due date, by calendar day. */
function describeTaskDue(dueDate: string, isDone: boolean): { label: string; tone: "overdue" | "soon" | "later" | "done" } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(`${dueDate}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
  if (isDone) return { label: "done", tone: "done" };
  if (days < 0) return { label: `overdue ${-days} day${days === -1 ? "" : "s"}`, tone: "overdue" };
  if (days === 0) return { label: "today", tone: "soon" };
  if (days === 1) return { label: "tomorrow", tone: "soon" };
  return { label: `in ${days} days`, tone: days <= 3 ? "soon" : "later" };
}

/** "14:30" → "2:30 PM". */
function clockTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** The one-line summary of whatever the task's kind adds — checklist progress, store, a reminder's repeat. (Its time is in the due column.) */
function kindSummary(task: Task): string {
  const parts: string[] = [];
  if (task.itemCount > 0) {
    parts.push(`${task.itemsDone}/${task.itemCount} ${task.kind === "shopping" ? "items" : "steps"}`);
  }
  if (task.kind === "shopping" && task.itemsTotal !== null) parts.push(money(task.itemsTotal));
  if (task.kind === "shopping" && task.store) parts.push(task.store);
  if (task.kind === "reminder") {
    if (task.repeat !== "none") parts.push(REPEATS.find((r) => r.id === task.repeat)?.label.toLowerCase() ?? "");
  }
  if (task.notes) parts.push(task.notes);
  return parts.join(" · ");
}

/** Shared between /tasks (every task in the org) and a project hub page (one project's tasks). */
export function TaskList({
  tasks,
  redirectPath,
  emptyLabel,
  showProject = false,
}: {
  tasks: Task[];
  redirectPath: string;
  emptyLabel: string;
  showProject?: boolean;
}) {
  if (tasks.length === 0) return <EmptyRow>{emptyLabel}</EmptyRow>;

  return (
    <>
      {tasks.map((task) => {
        const due = task.dueDate ? describeTaskDue(task.dueDate, task.isDone) : null;
        const summary = kindSummary(task);
        return (
          <div
            key={task.id}
            className="flex min-h-[52px] min-w-0 items-start gap-3 border-t border-line-soft px-[18px] py-[11px] sm:items-center"
          >
            <form action={toggleTask} className="pt-[1px] sm:pt-0">
              <input type="hidden" name="id" value={task.id} />
              <input type="hidden" name="done" value={String(!task.isDone)} />
              <input type="hidden" name="redirectPath" value={redirectPath} />
              <button
                type="submit"
                aria-label={task.isDone ? "Mark not done" : "Mark done"}
                className={`flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] border ${
                  task.isDone ? "border-ok-fg bg-ok-bg text-ok-fg" : "border-line text-transparent"
                }`}
              >
                <Icon name="check2" size={13} />
              </button>
            </form>
            <Icon name={KIND_ICON[task.kind] ?? "clipboard"} size={15} className="mt-[4px] shrink-0 text-body-soft sm:mt-0" />
            {/* Phones: the title wraps (up to 2 lines) and due/assignee, details and project stack beneath it.
                Wider screens: one line each, with assignee and due as right-hand columns. */}
            <div className="flex min-w-0 flex-1 flex-col gap-[2px] leading-[1.35]">
              <Link
                href={`/tasks/${task.id}`}
                className={`line-clamp-2 text-[13px] hover:underline sm:line-clamp-1 sm:truncate ${
                  task.isDone ? "text-faint line-through" : "font-medium"
                }`}
              >
                {task.title}
              </Link>
              {task.dueDate && due ? (
                <span className="flex flex-wrap items-center gap-x-[6px] text-[11px] sm:hidden">
                  <span className={due.tone === "overdue" ? "font-semibold text-bad-fg" : "text-ink"}>
                    {shortDate(task.dueDate)}
                    {task.kind === "reminder" && task.remindTime ? ` · ${clockTime(task.remindTime)}` : ""}
                  </span>
                  <span
                    className={
                      due.tone === "overdue" ? "text-bad-fg" : due.tone === "soon" ? "font-medium text-warn-fg" : "text-faint"
                    }
                  >
                    {due.label}
                  </span>
                  {task.assignedName ? <span className="text-muted">· {task.assignedName}</span> : null}
                </span>
              ) : task.assignedName ? (
                <span className="text-[11px] text-muted sm:hidden">{task.assignedName}</span>
              ) : null}
              {summary ? <span className="line-clamp-2 text-[11px] text-muted sm:line-clamp-1 sm:truncate">{summary}</span> : null}
              {showProject && task.projectTitle ? (
                <Link href={`/projects/${task.projectId}`} className="truncate text-[11px] text-muted underline">
                  {task.projectTitle}
                </Link>
              ) : null}
            </div>
            {task.assignedName ? (
              <span className="hidden shrink-0 items-center gap-[5px] text-[11px] text-muted sm:flex">
                <Icon name="user" size={12} />
                {task.assignedName}
              </span>
            ) : null}
            {/* Due column (wider screens) — fixed width, empty when there's no due date, so rows line up. */}
            <span className="hidden w-[118px] shrink-0 flex-col items-end leading-[1.3] sm:flex">
              {task.dueDate && due ? (
                <>
                  <span className={`font-mono text-[11.5px] ${due.tone === "overdue" ? "font-semibold text-bad-fg" : "text-ink"}`}>
                    {shortDate(task.dueDate)}
                    {task.kind === "reminder" && task.remindTime ? ` · ${clockTime(task.remindTime)}` : ""}
                  </span>
                  <span
                    className={`text-[10.5px] ${
                      due.tone === "overdue" ? "text-bad-fg" : due.tone === "soon" ? "font-medium text-warn-fg" : "text-faint"
                    }`}
                  >
                    {due.label}
                  </span>
                </>
              ) : null}
            </span>
            <form action={removeTask} className="pt-[2px] sm:pt-0">
              <input type="hidden" name="id" value={task.id} />
              <input type="hidden" name="redirectPath" value={redirectPath} />
              <button type="submit" aria-label="Delete task" className="cursor-pointer text-faint hover:text-bad-fg">
                <Icon name="close" size={15} />
              </button>
            </form>
          </div>
        );
      })}
    </>
  );
}
