import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody, optionalText, UUID, YMD } from "@/lib/api";
import { listTeam } from "@/lib/auth";
import { deleteTask, getTask, listTaskItems, setTaskDone, updateTask, type Repeat } from "@/lib/tasks";
import { REPEATS } from "@/lib/task-kinds";
import { validTimeZone } from "@/lib/time-zone";

type Context = { params: Promise<{ id: string }> };

/** GET → { task, items } — a task with its checklist steps / shopping items. */
export const GET = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Task");
  const task = await getTask(id, org.id);
  if (!task) throw new ApiError(404, "Task not found.");
  return NextResponse.json({ task, items: await listTaskItems(id, org.id) });
});

/**
 * PATCH { done } → mark done / not done (a repeating reminder rolls to its next date), and/or
 * { title, notes, dueDate, remindTime (HH:MM), repeat, store, assignedTo, timeZone } — what's sent changes.
 */
export const PATCH = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Task");
  const task = await getTask(id, org.id);
  if (!task) throw new ApiError(404, "Task not found.");
  const body = await jsonBody<Record<string, unknown>>(request);

  const fields = ["title", "notes", "dueDate", "remindTime", "repeat", "store", "assignedTo"];
  if (fields.some((f) => body[f] !== undefined)) {
    const title = optionalText(body.title);
    if (title === "" || title === null) throw new ApiError(400, "The title can't be empty.");
    const dueDate = optionalText(body.dueDate);
    const remindTime = optionalText(body.remindTime);
    const repeat = body.repeat as Repeat | undefined;
    if (repeat !== undefined && !REPEATS.some((r) => r.id === repeat)) throw new ApiError(400, "Unknown repeat.");
    let assignedTo = task.assignedTo;
    if (body.assignedTo !== undefined) {
      assignedTo = typeof body.assignedTo === "string" && UUID.test(body.assignedTo) ? body.assignedTo : null;
      if (assignedTo && !(await listTeam(org.id)).some((m) => m.id === assignedTo)) throw new ApiError(400, "Unknown team member.");
    }
    await updateTask(id, org.id, {
      title: title ?? task.title,
      notes: optionalText(body.notes) ?? task.notes,
      dueDate: dueDate === undefined ? task.dueDate : dueDate && YMD.test(dueDate) ? dueDate : null,
      assignedTo,
      store: optionalText(body.store) ?? task.store,
      remindTime: remindTime === undefined ? task.remindTime : remindTime && /^\d{1,2}:\d{2}$/.test(remindTime) ? remindTime : null,
      repeat: repeat ?? task.repeat,
      timeZone: validTimeZone(body.timeZone),
    });
  }
  if (typeof body.done === "boolean") await setTaskDone(id, org.id, body.done);
  return NextResponse.json({ task: await getTask(id, org.id) });
});

/** DELETE → removes a task. */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Task");
  await deleteTask(id, org.id);
  return NextResponse.json({ ok: true });
});
