"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import {
  saveLeadFinderSettings,
  scanOrgForLeads,
  setLeadStatus,
  type LeadFinderSettings,
} from "@/lib/lead-finder";
import { convertLeadToProject, dismissLead as dismissLeadCore, followUpOnLead } from "@/lib/lead-handling";

export type LeadFormState = { error?: string; ok?: string };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function refresh() {
  revalidatePath("/email");
  revalidatePath("/tasks/scheduled/lead-finder");
}

/** "Create project" on a lead — see lib/lead-handling.ts. */
export async function createProjectFromLead(form: FormData) {
  const session = await requireSession();
  const projectId = await convertLeadToProject(session.org.id, session.person.id, field(form, "id"));
  if (!projectId) return;
  refresh();
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

/** "Follow up" — see lib/lead-handling.ts. */
export async function followUpLead(form: FormData) {
  const session = await requireSession();
  if (!(await followUpOnLead(session.org.id, session.person.id, field(form, "id"), field(form, "timeZone")))) return;
  refresh();
  revalidatePath("/tasks");
}

/** "Not a lead" — see lib/lead-handling.ts. */
export async function dismissLead(form: FormData) {
  const session = await requireSession();
  if (!(await dismissLeadCore(session.org.id, field(form, "id")))) return;
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
