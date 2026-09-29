"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createScheduleEntry, deleteScheduleEntry } from "@/lib/schedule";

export type FormState = { error?: string; ok?: string };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function addScheduleEntry(_prev: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireSession();
  const projectId = field(form, "projectId");
  const date = field(form, "date");
  const startTime = field(form, "startTime") || "09:00";
  const endTime = field(form, "endTime") || "17:00";
  const redirectPath = field(form, "redirectPath") || "/schedule";
  if (!projectId) return { error: "Pick a project." };
  if (!date) return { error: "Pick a date." };

  const startsAt = new Date(`${date}T${startTime}:00`);
  const endsAt = new Date(`${date}T${endTime}:00`);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    return { error: "Enter a valid start and end time." };
  }

  await createScheduleEntry({
    orgId: org.id,
    projectId,
    assignedTo: field(form, "assignedTo") || null,
    startsAt,
    endsAt,
    notes: field(form, "notes"),
  });

  revalidatePath(redirectPath);
  revalidatePath("/schedule");
  return { ok: "Scheduled." };
}

export async function removeScheduleEntry(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const redirectPath = field(form, "redirectPath") || "/schedule";
  await deleteScheduleEntry(id, org.id);
  revalidatePath(redirectPath);
  revalidatePath("/schedule");
}
