"use server";

import { redirect } from "next/navigation";
import { completeOnboarding, requireSession } from "@/lib/auth";
import { COMPANY_TYPES } from "@/lib/project-types";

export type FormState = { error?: string };

export async function finishOnboarding(_prev: FormState, form: FormData): Promise<FormState> {
  const { org, person } = await requireSession();
  if (person.role !== "owner") redirect("/overview");

  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Enter your company name." };

  const companyType = String(form.get("companyType") ?? "");
  if (!COMPANY_TYPES.some((c) => c.id === companyType)) return { error: "Pick what kind of business this is." };

  await completeOnboarding(org.id, name, companyType);
  redirect("/overview");
}
