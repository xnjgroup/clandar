"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import {
  REPEATS,
  TASK_KINDS,
  addTaskItem,
  createTask,
  deleteTask,
  deleteTaskItem,
  setTaskDone,
  setTaskItemDone,
  updateTask,
  type Repeat,
  type TaskKind,
} from "@/lib/tasks";

export type FormState = { error?: string; ok?: string };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** `redirectPath` lets both the global /tasks page and a project hub page reuse this and revalidate their own route. */
export async function addTask(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  const title = field(form, "title");
  const kindField = field(form, "kind");
  const kind: TaskKind = TASK_KINDS.some((k) => k.id === kindField) ? (kindField as TaskKind) : "todo";
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

/** Saves the details form on /tasks/[id] — the shared fields plus whichever per-kind ones the form sent. */
export async function saveTask(_prev: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireSession();
  const id = field(form, "id");
  const title = field(form, "title");
  if (!title) return { error: "Give the task a title." };
  const repeatField = field(form, "repeat");

  await updateTask(id, org.id, {
    title,
    notes: field(form, "notes"),
    dueDate: field(form, "dueDate") || null,
    assignedTo: field(form, "assignedTo") || null,
    store: field(form, "store"),
    remindTime: field(form, "remindTime") || null,
    repeat: REPEATS.some((r) => r.id === repeatField) ? (repeatField as Repeat) : "none",
  });

  revalidatePath(`/tasks/${id}`);
  revalidatePath("/tasks");
  return { ok: "Saved." };
}

export async function toggleTask(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const done = field(form, "done") === "true";
  const redirectPath = field(form, "redirectPath") || "/tasks";
  await setTaskDone(id, org.id, done);
  revalidatePath(redirectPath);
  revalidatePath("/tasks");
}

export async function removeTask(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const redirectPath = field(form, "redirectPath") || "/tasks";
  await deleteTask(id, org.id);
  revalidatePath(redirectPath);
  // Deleting from the task's own page leaves nothing to show there.
  if (field(form, "leave") === "true") redirect(redirectPath);
}

/** A usable http(s) URL, or null — anything else (javascript:, mailto:, junk) isn't stored as a link. */
function httpUrl(value: string): URL | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".") ? url : null;
  } catch {
    return null;
  }
}

export async function addItem(_prev: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireSession();
  const taskId = field(form, "taskId");
  let label = field(form, "label");
  const urlField = field(form, "url");
  let url: URL | null = null;
  if (urlField) {
    url = httpUrl(urlField);
    if (!url) return { error: "That link doesn't look like a web address." };
  } else if (/^https?:\/\/\S+$/i.test(label)) {
    // A pasted link in the item box: keep it as the link, name the item after its site.
    url = httpUrl(label);
    if (url) label = url.hostname.replace(/^www\./, "");
  }
  if (!label && url) label = url.hostname.replace(/^www\./, "");
  if (!label) return { error: "Name the item." };
  const quantityField = field(form, "quantity");
  const quantity = quantityField ? Number(quantityField) : null;
  if (quantity !== null && !Number.isFinite(quantity)) return { error: "Quantity must be a number." };

  await addTaskItem(taskId, org.id, { label, quantity, unit: field(form, "unit"), url: url?.href ?? null });
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/tasks");
  return { ok: "Added." };
}

export async function toggleItem(form: FormData) {
  const { org } = await requireSession();
  await setTaskItemDone(field(form, "id"), org.id, field(form, "done") === "true");
  revalidatePath(`/tasks/${field(form, "taskId")}`);
  revalidatePath("/tasks");
}

export async function removeItem(form: FormData) {
  const { org } = await requireSession();
  await deleteTaskItem(field(form, "id"), org.id);
  revalidatePath(`/tasks/${field(form, "taskId")}`);
  revalidatePath("/tasks");
}
