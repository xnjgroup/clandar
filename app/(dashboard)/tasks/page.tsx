import Link from "next/link";
import { Card, CardTitle, PageBody, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { firstParam, hrefWith } from "@/lib/data";
import { listTeam, requireSession } from "@/lib/auth";
import { listTasks, type TaskKind } from "@/lib/tasks";
import { AddTaskForm } from "./add-task-form";
import { TaskList } from "./task-list";

const KIND_LABEL: Record<TaskKind, string> = { todo: "To-do", shopping: "Shopping list", permit: "Permit reminders" };

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
      <Card className="flex flex-col gap-[10px]">
        <CardTitle>Add a task</CardTitle>
        <AddTaskForm redirectPath="/tasks" defaultKind={kind ?? "todo"} members={team} />
      </Card>

      <div className="flex flex-wrap items-center gap-[9px]">
        <div className="flex min-w-0 flex-1 flex-wrap gap-[7px]">
          <Link
            href={hrefWith("/tasks", params, { kind: null })}
            className={`rounded-full px-[14px] py-[8px] text-[12.5px] font-medium ${
              !kind ? "bg-ink text-bg" : "border border-line bg-surface text-body"
            }`}
          >
            All
          </Link>
          {(Object.keys(KIND_LABEL) as TaskKind[]).map((k) => (
            <Link
              key={k}
              href={hrefWith("/tasks", params, { kind: k })}
              className={`rounded-full px-[14px] py-[8px] text-[12.5px] font-medium ${
                kind === k ? "bg-ink text-bg" : "border border-line bg-surface text-body"
              }`}
            >
              {KIND_LABEL[k]}
            </Link>
          ))}
        </div>
        <Link
          href={hrefWith("/tasks", params, { done: firstParam(params.done) === "true" ? null : "true" })}
          className="shrink-0 text-[11.5px] font-medium underline"
        >
          {firstParam(params.done) === "true" ? "Hide done" : "Show done"}
        </Link>
      </div>

      <TableCard>
        <TableHeader>
          <TableTitle>{kind ? KIND_LABEL[kind] : "All tasks"}</TableTitle>
        </TableHeader>
        <TaskList tasks={tasks} redirectPath="/tasks" emptyLabel="Nothing here." showJob />
      </TableCard>
    </PageBody>
  );
}
