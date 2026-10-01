"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { setInvoiceStatus } from "@/lib/email-invoice";

/** The approval queue's Approve / Reject buttons. */
export async function decideInvoice(form: FormData) {
  const { org, person } = await requireSession();
  const id = String(form.get("id") ?? "");
  const decision = form.get("decision") === "approve" ? "approved" : "rejected";
  await setInvoiceStatus(id, org.id, decision, person.id);
  revalidatePath("/approvals");
  revalidatePath("/invoices");
  revalidatePath("/overview");
}
