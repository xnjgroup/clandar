import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageBody, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { firstParam, hrefWith } from "@/lib/data";
import { listTeam, requireSession } from "@/lib/auth";
import { listTasks, type TaskKind } from "@/lib/tasks";
import { NewTaskDialog } from "./new-task-dialog";
import { TaskList } from "./task-list";

const KIND_LABEL: Record<TaskKind, string> = { todo: "To-do", shopping: "Shopping list", reminder: "Reminders" };

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const params = await searchParams;
  const kind = (firstParam(params.kind) || undefined) as TaskKind | undefined;
  const { org } = await requireSession();

  const [team, tasks] = await Promise.all([
    listTeam(org.id),
    listTasks(org.id, { kind, includeDone: firstParam(params.done) === "true" }),
  ]);

  return (
    <PageBody>
      {/* Top row: add a task (opens a modal) and the automations page, same height. */}
      <div className="flex items-center justify-between gap-[9px]">
        <NewTaskDialog defaultKind={kind ?? "todo"} members={team} />
        <Link
          href="/tasks/scheduled"
          className="flex h-[38px] shrink-0 items-center gap-[6px] rounded-full border border-line bg-surface px-[14px] text-[12.5px] font-medium"
        >
          <Icon name="clock" size={14} />
          Automations
        </Link>
      </div>

      {/* Kind filters: one row, sideways-scrolling on phones. */}
      <div className="-mx-[14px] flex min-w-0 gap-[7px] overflow-x-auto px-[14px] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <Link
          href={hrefWith("/tasks", params, { kind: null })}
          className={`shrink-0 rounded-full px-[14px] py-[8px] text-[12.5px] font-medium whitespace-nowrap ${
            !kind ? "bg-ink text-bg" : "border border-line bg-surface text-body"
          }`}
        >
          All
        </Link>
        {(Object.keys(KIND_LABEL) as TaskKind[]).map((k) => (
          <Link
            key={k}
            href={hrefWith("/tasks", params, { kind: k })}
            className={`shrink-0 rounded-full px-[14px] py-[8px] text-[12.5px] font-medium whitespace-nowrap ${
              kind === k ? "bg-ink text-bg" : "border border-line bg-surface text-body"
            }`}
          >
            {KIND_LABEL[k]}
          </Link>
        ))}
      </div>

      <TableCard>
        <TableHeader>
          <TableTitle>{kind ? KIND_LABEL[kind] : "All tasks"}</TableTitle>
          {/* The done toggle filters this list, so it lives on it. */}
          <Link
            href={hrefWith("/tasks", params, { done: firstParam(params.done) === "true" ? null : "true" })}
            className="ml-auto text-[11.5px] font-medium underline"
          >
            {firstParam(params.done) === "true" ? "Hide done" : "Show done"}
          </Link>
        </TableHeader>
        <TaskList tasks={tasks} redirectPath="/tasks" emptyLabel="Nothing here." showProject />
      </TableCard>
    </PageBody>
  );
}
