"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createScheduleEntry, deleteScheduleEntry } from "@/lib/schedule";
import { zonedTimeToUtc } from "@/lib/time-zone";

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
  const notes = field(form, "notes");
  if (!notes && !projectId) return { error: "Say what's happening." };
  if (!date) return { error: "Pick a date." };

  // Wall-clock times in the person's zone (from their browser) — the server may run in UTC.
  const timeZone = field(form, "timeZone") || "UTC";
  const startsAt = zonedTimeToUtc(date, startTime, timeZone);
  const endsAt = zonedTimeToUtc(date, endTime, timeZone);
  if (!startsAt || !endsAt || endsAt <= startsAt) {
    return { error: "Enter a valid start and end time." };
  }

  await createScheduleEntry({
    orgId: org.id,
    projectId: projectId || null,
    assignedTo: field(form, "assignedTo") || null,
    startsAt,
    endsAt,
    notes,
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
