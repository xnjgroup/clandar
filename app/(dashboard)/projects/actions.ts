"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import {
  assignProject,
  createProject,
  deleteProject,
  setProjectStatus,
  updateProject,
  type ProjectStatus,
} from "@/lib/projects";

export type FormState = { error?: string; ok?: string };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function addProject(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  const customerId = field(form, "customerId");
  const title = field(form, "title");
  if (!customerId) return { error: "Pick a customer." };
  if (!title) return { error: "Give the project a title." };

  const id = await createProject({
    orgId: session.org.id,
    customerId,
    title,
    projectTypeId: field(form, "projectTypeId") || null,
    address: field(form, "address"),
    notes: field(form, "notes"),
    dueDate: field(form, "dueDate") || null,
    createdBy: session.person.id,
  });

  revalidatePath("/projects");
  redirect(`/projects/${id}`);
}

export async function saveProject(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  await updateProject(id, org.id, {
    title: field(form, "title"),
    projectTypeId: field(form, "projectTypeId") || null,
    address: field(form, "address"),
    notes: field(form, "notes"),
    dueDate: field(form, "dueDate") || null,
  });
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
}

export async function changeProjectStatus(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const status = field(form, "status") as ProjectStatus;
  await setProjectStatus(id, org.id, status);
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
}

export async function changeProjectAssignee(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const assignedTo = field(form, "assignedTo") || null;
  await assignProject(id, org.id, assignedTo);
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
}

export async function removeProject(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  await deleteProject(id, org.id);
  revalidatePath("/projects");
  redirect("/projects");
}
