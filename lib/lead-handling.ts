/**
 * What happens when someone acts on an email lead — shared by the web's lead buttons
 * (app/(dashboard)/email/lead-actions.ts) and the app's API (app/api/v1/email/leads/…).
 */
import { findOrCreateCustomer } from "@/lib/customers";
import { copyEmailAttachmentsToProject } from "@/lib/email-to-project";
import { modifyMessageLabels } from "@/lib/gmail";
import { getLead, setLeadStatus } from "@/lib/lead-finder";
import { createProject } from "@/lib/projects";
import { createTask } from "@/lib/tasks";

/**
 * "Create project": customer from the sender, type/title/notes from the AI's read, the email's
 * attachments copied over; the lead is marked converted. Returns the project id (the existing one if
 * it was already converted), or null if the lead isn't this org's.
 */
export async function convertLeadToProject(orgId: string, personId: string, leadId: string): Promise<string | null> {
  const lead = await getLead(leadId, orgId);
  if (!lead) return null;
  if (lead.projectId) return lead.projectId;

  const customerId = await findOrCreateCustomer(orgId, lead.fromName || lead.fromEmail, {
    email: lead.fromEmail,
    phone: lead.details.phone,
  });
  const facts = [
    lead.details.timeline ? `Timeline: ${lead.details.timeline}` : null,
    lead.details.budget ? `Budget: ${lead.details.budget}` : null,
    lead.details.phone ? `Phone: ${lead.details.phone}` : null,
  ].filter(Boolean);
  const projectId = await createProject({
    orgId,
    customerId,
    title: lead.title || lead.subject || "New project",
    projectTypeId: lead.projectTypeId,
    address: lead.details.location ?? "",
    notes: [lead.summary, facts.join(" · "), `From email: “${lead.subject}”`].filter(Boolean).join("\n"),
    createdBy: personId,
  });
  await copyEmailAttachmentsToProject({
    orgId,
    connectorId: lead.connectorId,
    messageId: lead.messageId,
    projectId,
    uploadedBy: personId,
  }).catch(() => {}); // the project is what matters; attachments are a bonus
  await setLeadStatus(lead.id, orgId, "converted", projectId);
  return projectId;
}

/** "Follow up": a reminder in two days (with a link back to the email); the lead is marked reviewed. */
export async function followUpOnLead(orgId: string, personId: string, leadId: string, timeZone: string): Promise<boolean> {
  const lead = await getLead(leadId, orgId);
  if (!lead) return false;
  const due = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString("en-CA", { timeZone: timeZone || "UTC" });
  await createTask({
    orgId,
    projectId: lead.projectId,
    kind: "reminder",
    title: `Follow up: ${lead.fromName || lead.fromEmail} — ${lead.title || lead.subject}`,
    notes: `${lead.summary}\nEmail: /email/${lead.messageId}`,
    dueDate: due,
    assignedTo: personId,
    createdBy: personId,
    timeZone,
  });
  if (lead.status === "new") await setLeadStatus(lead.id, orgId, "reviewed");
  return true;
}

/** "Not a lead": out of the queue, its Gmail label removed, remembered so the AI learns from it. */
export async function dismissLead(orgId: string, leadId: string): Promise<boolean> {
  const lead = await getLead(leadId, orgId);
  if (!lead) return false;
  await setLeadStatus(lead.id, orgId, "dismissed");
  if (lead.gmailLabelId) {
    await modifyMessageLabels(orgId, lead.connectorId, lead.messageId, { remove: [lead.gmailLabelId] }).catch(() => {});
  }
  return true;
}
