"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { setInvoiceProject } from "@/lib/email-invoice";

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Links an invoice to one of the org's projects (or unlinks it, with an empty value) — from the invoice page. */
export async function linkInvoiceProject(form: FormData) {
  const { org } = await requireSession();
  const projectId = field(form, "projectId") || null;
  await setInvoiceProject(field(form, "invoiceId"), org.id, projectId);
  revalidatePath("/invoices", "layout");
  if (projectId) revalidatePath(`/projects/${projectId}`);
}
