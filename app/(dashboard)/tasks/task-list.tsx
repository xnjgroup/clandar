import Link from "next/link";
import { Icon } from "@/components/icons";
import { EmptyRow } from "@/components/ui";
import { relativeTime } from "@/lib/data";
import { REPEATS } from "@/lib/task-kinds";
import type { Task } from "@/lib/tasks";
import { removeTask, toggleTask } from "./actions";

const KIND_ICON = { todo: "check2", shopping: "briefcase", reminder: "clipboard" } as const;

/** The one-line summary of whatever the task's kind adds — checklist progress, store, reminder timing. */
function kindSummary(task: Task): string {
  const parts: string[] = [];
  if (task.itemCount > 0) {
    parts.push(`${task.itemsDone}/${task.itemCount} ${task.kind === "shopping" ? "items" : "steps"}`);
  }
  if (task.kind === "shopping" && task.store) parts.push(task.store);
  if (task.kind === "reminder") {
    if (task.remindTime) parts.push(`at ${task.remindTime}`);
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
        const overdue = task.dueDate && !task.isDone && new Date(task.dueDate) < new Date();
        const summary = kindSummary(task);
        return (
          <div
            key={task.id}
            className="flex min-h-[52px] min-w-0 flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[11px]"
          >
            <form action={toggleTask}>
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
            <Icon name={KIND_ICON[task.kind] ?? "check2"} size={15} className="shrink-0 text-body-soft" />
            <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
              <Link
                href={`/tasks/${task.id}`}
                className={`truncate text-[13px] hover:underline ${task.isDone ? "text-faint line-through" : "font-medium"}`}
              >
                {task.title}
              </Link>
              {summary ? <span className="truncate text-[11px] text-muted">{summary}</span> : null}
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
            {task.dueDate ? (
              <span className={`shrink-0 font-mono text-[11px] ${overdue ? "text-bad-fg" : "text-faint"}`}>
                {relativeTime(new Date(task.dueDate))}
              </span>
            ) : null}
            <form action={removeTask}>
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
