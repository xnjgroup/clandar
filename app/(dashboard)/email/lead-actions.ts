"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { findOrCreateCustomer } from "@/lib/customers";
import { copyEmailAttachmentsToProject } from "@/lib/email-to-project";
import { modifyMessageLabels } from "@/lib/gmail";
import {
  getLead,
  saveLeadFinderSettings,
  scanOrgForLeads,
  setLeadStatus,
  type LeadFinderSettings,
} from "@/lib/lead-finder";
import { createProject } from "@/lib/projects";
import { createTask } from "@/lib/tasks";

export type LeadFormState = { error?: string; ok?: string };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function refresh() {
  revalidatePath("/email");
  revalidatePath("/tasks/scheduled/lead-finder");
}

/** "Create project" on a lead: customer from the sender, type/title/notes from the AI's read, attachments copied over. */
export async function createProjectFromLead(form: FormData) {
  const session = await requireSession();
  const lead = await getLead(field(form, "id"), session.org.id);
  if (!lead) return;
  if (lead.projectId) redirect(`/projects/${lead.projectId}`);

  const customerId = await findOrCreateCustomer(session.org.id, lead.fromName || lead.fromEmail, {
    email: lead.fromEmail,
    phone: lead.details.phone,
  });
  const facts = [
    lead.details.timeline ? `Timeline: ${lead.details.timeline}` : null,
    lead.details.budget ? `Budget: ${lead.details.budget}` : null,
    lead.details.phone ? `Phone: ${lead.details.phone}` : null,
  ].filter(Boolean);
  const projectId = await createProject({
    orgId: session.org.id,
    customerId,
    title: lead.title || lead.subject || "New project",
    projectTypeId: lead.projectTypeId,
    address: lead.details.location ?? "",
    notes: [lead.summary, facts.join(" · "), `From email: “${lead.subject}”`].filter(Boolean).join("\n"),
    createdBy: session.person.id,
  });
  await copyEmailAttachmentsToProject({
    orgId: session.org.id,
    connectorId: lead.connectorId,
    messageId: lead.messageId,
    projectId,
    uploadedBy: session.person.id,
  }).catch(() => {}); // the project is what matters; attachments are a bonus
  await setLeadStatus(lead.id, session.org.id, "converted", projectId);
  refresh();
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

/** "Follow up": a reminder in two days (with a link back to the email), and the lead is marked reviewed. */
export async function followUpLead(form: FormData) {
  const session = await requireSession();
  const lead = await getLead(field(form, "id"), session.org.id);
  if (!lead) return;
  const due = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: field(form, "timeZone") || "UTC",
  });
  await createTask({
    orgId: session.org.id,
    projectId: lead.projectId,
    kind: "reminder",
    title: `Follow up: ${lead.fromName || lead.fromEmail} — ${lead.title || lead.subject}`,
    notes: `${lead.summary}\nEmail: /email/${lead.messageId}`,
    dueDate: due,
    assignedTo: session.person.id,
    createdBy: session.person.id,
    timeZone: field(form, "timeZone"),
  });
  if (lead.status === "new") await setLeadStatus(lead.id, session.org.id, "reviewed");
  refresh();
  revalidatePath("/tasks");
}

/** "Not a lead": out of the queue, its Gmail label removed, and remembered so the AI learns from it. */
export async function dismissLead(form: FormData) {
  const session = await requireSession();
  const lead = await getLead(field(form, "id"), session.org.id);
  if (!lead) return;
  await setLeadStatus(lead.id, session.org.id, "dismissed");
  if (lead.gmailLabelId) {
    await modifyMessageLabels(session.org.id, lead.connectorId, lead.messageId, { remove: [lead.gmailLabelId] }).catch(
      () => {},
    );
  }
  refresh();
}

/** Puts a dismissed/handled lead back in the queue. */
export async function restoreLead(form: FormData) {
  const session = await requireSession();
  await setLeadStatus(field(form, "id"), session.org.id, "new");
  refresh();
}

export async function saveLeadFinder(_prev: LeadFormState, form: FormData): Promise<LeadFormState> {
  const session = await requireSession();
  if (session.person.role !== "owner") return { error: "Only an owner can change the lead finder." };
  const checkMinutes = Number(field(form, "checkMinutes"));
  const minConfidence = Number(field(form, "minConfidence"));
  const digestTime = field(form, "digestTime") || "07:30";
  if (![15, 30, 60].includes(checkMinutes)) return { error: "Pick how often to check." };
  if (!(minConfidence >= 0.3 && minConfidence <= 0.95)) return { error: "Pick how strict it should be." };
  if (!/^\d{1,2}:\d{2}$/.test(digestTime)) return { error: "Pick a digest time." };
  const on = (name: string) => form.get(name) === "on";

  const settings: Omit<LeadFinderSettings, "lastScanAt" | "lastScanNote" | "lastDigestAt"> = {
    isEnabled: on("isEnabled"),
    checkMinutes: checkMinutes as 15 | 30 | 60,
    minConfidence,
    gmailLabels: on("gmailLabels"),
    instructions: field(form, "instructions"),
    digestEnabled: on("digestEnabled"),
    digestTime,
    timeZone: field(form, "timeZone"),
    digestBell: on("digestBell"),
    digestPush: on("digestPush"),
    digestEmail: on("digestEmail"),
  };
  await saveLeadFinderSettings(session.org.id, settings);
  refresh();
  revalidatePath("/tasks/scheduled");
  return { ok: settings.isEnabled ? "Saved — the lead finder is on." : "Saved — the lead finder is off." };
}

/** "Scan now": checks new mail immediately instead of waiting for the next scheduled scan. */
// useActionState always passes the previous state first; this action doesn't need it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function scanLeadsNow(_prev: LeadFormState): Promise<LeadFormState> {
  const session = await requireSession();
  try {
    const { checked, found } = await scanOrgForLeads(session.org.id);
    refresh();
    return { ok: `Checked ${checked} new email${checked === 1 ? "" : "s"} — found ${found} lead${found === 1 ? "" : "s"}.` };
  } catch (error) {
    refresh();
    return { error: error instanceof Error ? error.message : "Scan failed." };
  }
}
