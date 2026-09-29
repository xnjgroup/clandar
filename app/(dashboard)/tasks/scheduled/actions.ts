"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { enqueueRunNow } from "@/lib/scheduled-tasks-queue";
import {
  createScheduledTask,
  deleteScheduledTask,
  setScheduledTaskEnabled,
  TASK_PRESETS,
  type Frequency,
} from "@/lib/scheduled-tasks";

export type FormState = { error?: string };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function addScheduledTask(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  const name = field(form, "name");
  const prompt = field(form, "prompt");
  const frequency = field(form, "frequency") as Frequency;
  const runTime = field(form, "runTime") || "08:00";
  const runWeekday = field(form, "runWeekday");

  if (!name) return { error: "Give the task a name." };
  if (!prompt) return { error: "Describe what it should do." };
  if (!["daily", "weekdays", "weekly"].includes(frequency)) return { error: "Pick a frequency." };
  if (frequency === "weekly" && runWeekday === "") return { error: "Pick a day of the week." };

  const id = await createScheduledTask({
    orgId: session.org.id,
    name,
    description: field(form, "description"),
    icon: field(form, "icon") || "bot",
    prompt,
    frequency,
    runTime,
    runWeekday: frequency === "weekly" ? Number(runWeekday) : null,
    createdBy: session.person.id,
  });

  revalidatePath("/tasks/scheduled");
  redirect(`/tasks/scheduled/${id}`);
}

/** Creates a task directly from one of TASK_PRESETS — bound to its index via `.bind(null, index)` on a form. */
export async function addPresetTask(index: number) {
  const session = await requireSession();
  const preset = TASK_PRESETS[index];
  if (!preset) return;

  const id = await createScheduledTask({
    orgId: session.org.id,
    name: preset.name,
    description: preset.description,
    icon: preset.icon,
    prompt: preset.prompt,
    frequency: preset.frequency,
    runTime: preset.runTime,
    runWeekday: preset.runWeekday,
    createdBy: session.person.id,
  });

  revalidatePath("/tasks/scheduled");
  redirect(`/tasks/scheduled/${id}`);
}

export async function toggleScheduledTask(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const enabled = field(form, "enabled") === "true";
  await setScheduledTaskEnabled(id, org.id, enabled);
  revalidatePath("/tasks/scheduled");
  revalidatePath(`/tasks/scheduled/${id}`);
}

export async function removeScheduledTask(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  await deleteScheduledTask(id, org.id);
  revalidatePath("/tasks/scheduled");
  redirect("/tasks/scheduled");
}

export async function runScheduledTaskNow(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  await enqueueRunNow(id, org.id);
  revalidatePath(`/tasks/scheduled/${id}`);
}
