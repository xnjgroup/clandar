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
  updateScheduledTaskSchedule,
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
    timeZone: field(form, "timeZone"),
    createdBy: session.person.id,
  });

  revalidatePath("/tasks/scheduled");
  redirect(`/tasks/scheduled/${id}`);
}

/** The schedule fields from ScheduleFields, validated; null when they don't add up. */
function scheduleFrom(form: FormData, fallback?: { frequency: Frequency; runTime: string; runWeekday: number | null }) {
  const frequency = (field(form, "frequency") || fallback?.frequency) as Frequency;
  const runTime = field(form, "runTime") || fallback?.runTime || "08:00";
  const weekdayField = field(form, "runWeekday");
  if (!["daily", "weekdays", "weekly"].includes(frequency) || !/^\d{1,2}:\d{2}$/.test(runTime)) return null;
  const runWeekday = frequency === "weekly" ? Number(weekdayField || fallback?.runWeekday) : null;
  if (frequency === "weekly" && !(Number.isInteger(runWeekday) && runWeekday! >= 0 && runWeekday! <= 6)) return null;
  return { frequency, runTime, runWeekday, timeZone: field(form, "timeZone") };
}

/**
 * Creates an automation from one of TASK_PRESETS — bound to its index via
 * `.bind(null, index)` on a form — on the schedule picked in the form (the
 * preset's own schedule is just the starting point).
 */
export async function addPresetTask(index: number, form: FormData) {
  const session = await requireSession();
  const preset = TASK_PRESETS[index];
  if (!preset) return;
  const schedule = scheduleFrom(form, preset) ?? {
    frequency: preset.frequency,
    runTime: preset.runTime,
    runWeekday: preset.runWeekday,
    timeZone: field(form, "timeZone"),
  };

  const id = await createScheduledTask({
    orgId: session.org.id,
    name: preset.name,
    description: preset.description,
    icon: preset.icon,
    prompt: preset.prompt,
    ...schedule,
    createdBy: session.person.id,
  });

  revalidatePath("/tasks/scheduled");
  revalidatePath("/schedule");
  redirect(`/tasks/scheduled/${id}`);
}

/** "Change schedule" on an automation's page. */
export async function changeScheduledTaskSchedule(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const schedule = scheduleFrom(form);
  if (!schedule) return;
  await updateScheduledTaskSchedule(id, org.id, schedule);
  revalidatePath(`/tasks/scheduled/${id}`);
  revalidatePath("/tasks/scheduled");
  revalidatePath("/schedule");
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
