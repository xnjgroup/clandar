import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { createTask, listTasks, type TaskKind } from "@/lib/tasks";
import { validTimeZone } from "@/lib/time-zone";

const KINDS: TaskKind[] = ["todo", "shopping", "reminder"];

/** GET ?kind=todo|shopping|reminder&done=true → tasks (open only unless done=true). */
export const GET = api(async (request: Request) => {
  const { org } = await apiSession();
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") as TaskKind | null;
  const tasks = await listTasks(org.id, {
    kind: kind && KINDS.includes(kind) ? kind : undefined,
    includeDone: params.get("done") === "true",
  });
  return NextResponse.json({ tasks });
});

/** POST { title, kind?, notes?, dueDate? (YYYY-MM-DD), timeZone? } → { id }. */
export const POST = api(async (request: Request) => {
  const { org, person } = await apiSession();
  const body = await jsonBody<{ title?: string; kind?: TaskKind; notes?: string; dueDate?: string | null; timeZone?: string }>(
    request,
  );
  const title = body.title?.trim();
  if (!title) throw new ApiError(400, "Give the task a title.");
  const kind = body.kind && KINDS.includes(body.kind) ? body.kind : "todo";
  const dueDate = body.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ? body.dueDate : null;
  const id = await createTask({
    orgId: org.id,
    projectId: null,
    kind,
    title,
    notes: body.notes?.trim() ?? "",
    dueDate,
    assignedTo: null,
    createdBy: person.id,
    timeZone: validTimeZone(body.timeZone),
  });
  return NextResponse.json({ id }, { status: 201 });
});
