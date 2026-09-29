"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createCustomer, deleteCustomer, updateCustomer } from "@/lib/customers";
import { deleteProject } from "@/lib/projects";

export type FormState = { error?: string; ok?: string };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function addCustomer(_prev: FormState, form: FormData): Promise<FormState> {
  const { org } = await requireSession();
  const name = field(form, "name");
  if (!name) return { error: "Give the customer a name." };

  const id = await createCustomer({
    orgId: org.id,
    name,
    email: field(form, "email") || null,
    phone: field(form, "phone") || null,
    address: field(form, "address") || null,
    notes: field(form, "notes"),
  });

  revalidatePath("/customers");
  redirect(`/customers/${id}`);
}

export async function saveCustomer(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  await updateCustomer(id, org.id, {
    name: field(form, "name"),
    email: field(form, "email") || null,
    phone: field(form, "phone") || null,
    address: field(form, "address") || null,
    notes: field(form, "notes"),
  });
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
}

export async function removeCustomer(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  await deleteCustomer(id, org.id);
  revalidatePath("/customers");
  redirect("/customers");
}

/** Deletes a project from the customer's own page — stays put here rather than the projects list's own remove action, which redirects to /projects. */
export async function removeCustomerProject(form: FormData) {
  const { org } = await requireSession();
  const projectId = field(form, "projectId");
  const customerId = field(form, "customerId");
  await deleteProject(projectId, org.id);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/projects");
}
