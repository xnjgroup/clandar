import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { Card, CardTitle, EmptyRow, PageBody, Pill, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { listTeam, requireSession } from "@/lib/auth";
import { money } from "@/lib/data";
import { TASK_KINDS, getTask, listTaskItems } from "@/lib/tasks";
import { removeItem, removeTask, toggleItem, toggleTask } from "../actions";
import { AddItemForm } from "./add-item-form";
import { TaskDetailsForm } from "./task-details-form";

/** quantity × price for a shopping item (quantity defaults to 1). */
function lineTotal(item: { quantity: number | null; unitPrice: number | null }): number {
  return (item.quantity ?? 1) * (item.unitPrice ?? 0);
}

/** One task's own page — the shared details plus whatever structure its kind has (checklist, shopping items, reminder timing). */
export default async function TaskDetailPage({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  const { org } = await requireSession();
  const task = await getTask(id, org.id);
  if (!task) notFound();

  const [team, items] = await Promise.all([listTeam(org.id), listTaskItems(task.id, org.id)]);
  const hasItems = task.kind === "todo" || task.kind === "shopping";
  const priced = items.filter((i) => i.unitPrice !== null);
  const listTotal = priced.reduce((sum, i) => sum + lineTotal(i), 0);
  const boughtTotal = priced.filter((i) => i.isDone).reduce((sum, i) => sum + lineTotal(i), 0);
  const backPath = task.projectId ? `/projects/${task.projectId}` : "/tasks";

  return (
    <PageBody>
      <Card className="flex flex-col gap-[13px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <form action={toggleTask}>
            <input type="hidden" name="id" value={task.id} />
            <input type="hidden" name="done" value={String(!task.isDone)} />
            <input type="hidden" name="redirectPath" value={`/tasks/${task.id}`} />
            <button
              type="submit"
              aria-label={task.isDone ? "Mark not done" : "Mark done"}
              className={`flex size-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] border ${
                task.isDone ? "border-ok-fg bg-ok-bg text-ok-fg" : "border-line text-transparent"
              }`}
            >
              <Icon name="check2" size={14} />
            </button>
          </form>
          <CardTitle>{task.title}</CardTitle>
          <Pill tone={task.isDone ? "ok" : "idle"}>
            {TASK_KINDS.find((k) => k.id === task.kind)?.label ?? task.kind}
            {task.isDone ? " · done" : ""}
          </Pill>
          {task.projectTitle ? (
            <Link href={`/projects/${task.projectId}`} className="text-[12px] font-medium underline">
              {task.projectTitle}
            </Link>
          ) : null}
          <Link href={backPath} className="ml-auto text-[11.5px] font-medium underline">
            {task.projectId ? "Back to project" : "All tasks"}
          </Link>
        </div>

        <TaskDetailsForm task={task} members={team} />

        <form action={removeTask} className="self-start">
          <input type="hidden" name="id" value={task.id} />
          <input type="hidden" name="redirectPath" value={backPath} />
          <input type="hidden" name="leave" value="true" />
          <button type="submit" className="cursor-pointer text-[11.5px] font-medium text-bad-fg underline">
            Delete task
          </button>
        </form>
      </Card>

      {hasItems ? (
        <TableCard>
          <TableHeader>
            <TableTitle>{task.kind === "shopping" ? "Items" : "Checklist"}</TableTitle>
            {items.length > 0 ? (
              <span className="font-mono text-[11px] text-faint">
                {items.filter((i) => i.isDone).length}/{items.length}
              </span>
            ) : null}
          </TableHeader>
          <div className="border-t border-line-soft px-[18px] py-[13px]">
            <AddItemForm taskId={task.id} shopping={task.kind === "shopping"} />
          </div>
          {items.length === 0 ? (
            <EmptyRow>{task.kind === "shopping" ? "Nothing on the list yet." : "No steps yet."}</EmptyRow>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex min-h-[46px] items-center gap-3 border-t border-line-soft px-[18px] py-[9px]"
              >
                <form action={toggleItem}>
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="done" value={String(!item.isDone)} />
                  <button
                    type="submit"
                    aria-label={item.isDone ? "Mark not done" : "Mark done"}
                    className={`flex size-[20px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border ${
                      item.isDone ? "border-ok-fg bg-ok-bg text-ok-fg" : "border-line text-transparent"
                    }`}
                  >
                    <Icon name="check2" size={12} />
                  </button>
                </form>
                <span className="flex min-w-0 flex-1 flex-col leading-[1.35]">
                  <span className={`truncate text-[13px] ${item.isDone ? "text-faint line-through" : ""}`}>
                    {item.label}
                  </span>
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      title={item.url}
                      className="flex min-w-0 items-center gap-[4px] text-[11px] text-muted underline hover:text-ink"
                    >
                      <Icon name="link2" size={11} className="shrink-0" />
                      <span className="truncate">{new URL(item.url).hostname.replace(/^www\./, "")}</span>
                    </a>
                  ) : null}
                </span>
                {item.quantity !== null || item.unit ? (
                  <span className="shrink-0 font-mono text-[11.5px] text-muted">
                    {item.quantity ?? ""} {item.unit}
                  </span>
                ) : null}
                {task.kind === "shopping" ? (
                  // Price column: "× $12.50" per unit, then the line total — blank when no price was entered.
                  <span className="flex w-[110px] shrink-0 flex-col items-end leading-[1.3]">
                    {item.unitPrice !== null ? (
                      <>
                        <span className={`font-mono text-[12px] font-semibold ${item.isDone ? "text-faint" : ""}`}>
                          {money(lineTotal(item))}
                        </span>
                        {(item.quantity ?? 1) !== 1 ? (
                          <span className="font-mono text-[10.5px] text-faint">{money(item.unitPrice)} each</span>
                        ) : null}
                      </>
                    ) : null}
                  </span>
                ) : null}
                <form action={removeItem}>
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="taskId" value={task.id} />
                  <button type="submit" aria-label="Remove" className="cursor-pointer text-faint hover:text-bad-fg">
                    <Icon name="close" size={14} />
                  </button>
                </form>
              </div>
            ))
          )}
          {task.kind === "shopping" && priced.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-[18px] gap-y-[4px] border-t border-line-soft bg-[#fafbf9] px-[18px] py-[11px] text-[12px]">
              <span className="text-muted">
                {priced.length < items.length ? `${items.length - priced.length} item(s) without a price` : "All items priced"}
              </span>
              <span className="ml-auto text-muted">
                Bought <span className="font-mono font-semibold text-ink">{money(boughtTotal)}</span>
              </span>
              <span className="text-muted">
                Total <span className="font-mono text-[13px] font-bold text-ink">{money(listTotal)}</span>
              </span>
            </div>
          ) : null}
        </TableCard>
      ) : null}
    </PageBody>
  );
}
