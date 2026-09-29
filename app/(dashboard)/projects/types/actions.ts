"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createProjectType, deleteProjectType, renameProjectType } from "@/lib/project-types";

export type FormState = { error?: string };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function addProjectType(_prev: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireSession();
  const name = field(form, "name");
  if (!name) return { error: "Give it a name." };

  await createProjectType(org.id, name, field(form, "icon") || "briefcase");
  revalidatePath("/projects/types");
  return {};
}

export async function saveProjectType(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  await renameProjectType(id, org.id, field(form, "name"), field(form, "icon") || "briefcase");
  revalidatePath("/projects/types");
}

export async function removeProjectType(form: FormData) {
  const { org } = await requireSession();
  await deleteProjectType(field(form, "id"), org.id);
  revalidatePath("/projects/types");
}
