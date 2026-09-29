"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { assignJob, createJob, deleteJob, setJobStatus, updateJob, type JobStatus, type Trade } from "@/lib/jobs";

export type FormState = { error?: string; ok?: string };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function addJob(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  const customerId = field(form, "customerId");
  const title = field(form, "title");
  const trade = field(form, "trade") as Trade;
  if (!customerId) return { error: "Pick a customer." };
  if (!title) return { error: "Give the job a title." };

  const id = await createJob({
    orgId: session.org.id,
    customerId,
    title,
    trade,
    address: field(form, "address"),
    notes: field(form, "notes"),
    createdBy: session.person.id,
  });

  revalidatePath("/jobs");
  redirect(`/jobs/${id}`);
}

export async function saveJob(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  await updateJob(id, org.id, {
    title: field(form, "title"),
    trade: field(form, "trade") as Trade,
    address: field(form, "address"),
    notes: field(form, "notes"),
  });
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
}

export async function changeJobStatus(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const status = field(form, "status") as JobStatus;
  await setJobStatus(id, org.id, status);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
}

export async function changeJobAssignee(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const assignedTo = field(form, "assignedTo") || null;
  await assignJob(id, org.id, assignedTo);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
}

export async function removeJob(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  await deleteJob(id, org.id);
  revalidatePath("/jobs");
  redirect("/jobs");
}
