"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createTask, deleteTask, setTaskDone, type TaskKind } from "@/lib/tasks";

export type FormState = { error?: string; ok?: string };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** `redirectPath` lets both the global /tasks page and a project hub page reuse this and revalidate their own route. */
export async function addTask(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  const title = field(form, "title");
  const kind = (field(form, "kind") || "todo") as TaskKind;
  const projectId = field(form, "projectId") || null;
  const dueDate = field(form, "dueDate") || null;
  const redirectPath = field(form, "redirectPath") || "/tasks";
  if (!title) return { error: "Give the task a title." };

  await createTask({
    orgId: session.org.id,
    projectId,
    kind,
    title,
    dueDate,
    assignedTo: field(form, "assignedTo") || null,
    createdBy: session.person.id,
  });

  revalidatePath(redirectPath);
  return { ok: "Added." };
}

export async function toggleTask(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const done = field(form, "done") === "true";
  const redirectPath = field(form, "redirectPath") || "/tasks";
  await setTaskDone(id, org.id, done);
  revalidatePath(redirectPath);
}

export async function removeTask(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const redirectPath = field(form, "redirectPath") || "/tasks";
  await deleteTask(id, org.id);
  revalidatePath(redirectPath);
}
