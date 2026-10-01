"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { encryptionConfigured } from "@/lib/crypto";
import { query, queryOne } from "@/lib/db";
import { ROLES, sendInviteEmail } from "@/lib/org-members";
import { originFromHeaders } from "@/lib/request-origin";
import {
  createLlmProvider,
  deleteLlmProvider,
  listLlmProviders,
  probeLlmProvider,
  setChatProvider,
  setDefaultLlmProvider,
  setEmailAnalyzerProvider,
  setInvoiceProvider,
  setLlmProviderEnabled,
  setLlmProviderModel,
  setQuoteProvider,
} from "@/lib/llm-providers";
import { redirect } from "next/navigation";
import {
  deleteOrganization,
  inviteTeammate,
  removeTeammate,
  requireSession,
  revokeInvite,
  signOut,
  updateAssistantName,
  updateOrgName,
  updateTeammateRole,
  ASSISTANT_NAME_PATTERN,
} from "@/lib/auth";

const PATH = "/settings";

export type FormState = { error?: string; ok?: string };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Adds an OpenAI-compatible provider, then immediately lists its models to
 * confirm it works — there's no model field here, the test picks one for you.
 */
export async function addLlmProvider(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  const name = field(form, "name");
  const baseUrl = field(form, "baseUrl");
  const apiKey = field(form, "apiKey");
  const makeDefault = field(form, "makeDefault") === "true";

  if (!name) return { error: "Give the provider a name." };

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { error: "Enter the API's base URL, for example http://localhost:1234/v1." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "Only http:// and https:// URLs are supported." };
  }
  if (apiKey && !encryptionConfigured()) {
    return {
      error: "APP_ENCRYPTION_KEY is not set, so the API key cannot be stored. Add one to .env.local.",
    };
  }

  const existing = await listLlmProviders(session.org.id);

  let id: string;
  try {
    id = await createLlmProvider({
      orgId: session.org.id,
      name,
      baseUrl: parsed.toString(),
      apiKey: apiKey || null,
      createdBy: session.person.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("llm_providers_org_name_key")) {
      return { error: `A provider named “${name}” already exists.` };
    }
    return { error: message || "Could not save the provider." };
  }

  // The first provider ever added becomes the default automatically —
  // otherwise nothing would use it until someone remembered to set one.
  if (makeDefault || existing.length === 0) {
    await setDefaultLlmProvider(id, session.org.id);
  }

  const probe = await probeLlmProvider(id, session.org.id);

  revalidatePath(PATH);
  return probe.ok
    ? { ok: `${name} connected — ${probe.message}.` }
    : { error: `${name} was saved, but the test call failed: ${probe.message}` };
}

export async function testLlmProvider(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  await probeLlmProvider(id, org.id);
  revalidatePath(PATH);
}

export async function setLlmModel(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const model = field(form, "model");
  if (model) await setLlmProviderModel(id, org.id, model);
  revalidatePath(PATH);
}

export async function makeDefaultProvider(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  await setDefaultLlmProvider(id, org.id);
  revalidatePath(PATH);
}

export async function selectEmailProvider(form: FormData) {
  const { org } = await requireSession();
  await setEmailAnalyzerProvider(field(form, "id") || null, field(form, "model") || null, org.id);
  revalidatePath(PATH);
}

export async function selectInvoiceProvider(form: FormData) {
  const { org } = await requireSession();
  await setInvoiceProvider(field(form, "id") || null, field(form, "model") || null, org.id);
  revalidatePath(PATH);
}

export async function selectQuoteProvider(form: FormData) {
  const { org } = await requireSession();
  await setQuoteProvider(field(form, "id") || null, field(form, "model") || null, org.id);
  revalidatePath(PATH);
}

export async function selectChatProvider(form: FormData) {
  const { org } = await requireSession();
  await setChatProvider(field(form, "id") || null, field(form, "model") || null, org.id);
  revalidatePath(PATH);
}

export async function toggleLlmProvider(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  const enabled = field(form, "enabled") === "true";
  await setLlmProviderEnabled(id, org.id, enabled);
  revalidatePath(PATH);
}

export async function removeLlmProvider(form: FormData) {
  const { org } = await requireSession();
  const id = field(form, "id");
  await deleteLlmProvider(id, org.id);
  revalidatePath(PATH);
}

/* ── Team ─────────────────────────────────────────────────── */


export async function inviteMember(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  if (session.person.role !== "owner") return { error: "Only an owner can invite people." };
  const email = field(form, "email");
  const role = field(form, "role") || "crew";
  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };
  if (!ROLES.includes(role)) return { error: "Pick a role." };

  await inviteTeammate(session.org.id, session.person.id, email, role);
  revalidatePath(PATH);
  const sent = await emailInvite(session, email, role);
  return sent.ok ? { ok: `Invited ${email} — an invitation email is on its way.` } : { ok: `Invited ${email}. ${sent.why}` };
}

/** Emails the invite (lib/org-members.ts) from this session's org and person. */
async function emailInvite(session: Awaited<ReturnType<typeof requireSession>>, email: string, role: string) {
  return sendInviteEmail({
    orgId: session.org.id,
    orgName: session.org.name,
    inviter: session.person.name || session.person.email,
    email,
    role,
    origin: originFromHeaders(await headers()),
  });
}

/** Re-sends the invitation email for a pending invite. */
export async function resendInvite(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  if (session.person.role !== "owner") return { error: "Only an owner can resend invites." };
  const invite = await queryOne<{ email: string; role: string }>(
    `SELECT email, role FROM org_invites WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL`,
    [field(form, "id"), session.org.id],
  );
  if (!invite) return { error: "That invite no longer exists." };
  const sent = await emailInvite(session, invite.email, invite.role);
  if (!sent.ok) return { error: sent.why };
  await query(`UPDATE org_invites SET created_at = now() WHERE id = $1`, [field(form, "id")]);
  revalidatePath(PATH);
  return { ok: `Sent again to ${invite.email}.` };
}

export async function cancelInvite(form: FormData) {
  const { org, person } = await requireSession();
  if (person.role !== "owner") return;
  const id = field(form, "id");
  await revokeInvite(org.id, id);
  revalidatePath(PATH);
}

export async function changeTeammateRole(form: FormData) {
  const { org, person } = await requireSession();
  const id = field(form, "id");
  const role = field(form, "role");
  // Owners only, and not on themselves (so a workspace can't lose its last owner by accident).
  if (person.role !== "owner" || id === person.id || !ROLES.includes(role)) return;
  await updateTeammateRole(org.id, id, role);
  revalidatePath(PATH);
}

export async function removeTeammateAction(form: FormData) {
  const { org, person } = await requireSession();
  if (person.role !== "owner") return;
  const id = field(form, "id");
  await removeTeammate(org.id, id);
  revalidatePath(PATH);
}

export async function renameOrg(_prev: FormState, form: FormData): Promise<FormState> {
  const { org, person } = await requireSession();
  if (person.role !== "owner") return { error: "Only the owner can rename the workspace." };
  const name = field(form, "name");
  if (!name) return { error: "Enter a name." };

  await updateOrgName(org.id, name);
  revalidatePath(PATH);
  return { ok: "Saved." };
}

/** Renames the team's assistant (shown on its button, chat and Overview card; it uses the name for itself too). */
export async function renameAssistant(_prev: FormState, form: FormData): Promise<FormState> {
  const { org, person } = await requireSession();
  if (person.role !== "owner") return { error: "Only the owner can rename the assistant." };
  const name = field(form, "name");
  if (!ASSISTANT_NAME_PATTERN.test(name)) {
    return { error: "Use one word — letters and numbers only, up to 10 characters." };
  }
  await updateAssistantName(org.id, name);
  // The name shows in the app shell on every page.
  revalidatePath("/", "layout");
  return { ok: "Saved." };
}

/**
 * Permanently deletes the org and everything in it. The confirming click
 * already happened in the browser (see delete-company-form.tsx's modal) — the
 * server side re-checks the typed name as defense in depth, since a form
 * submission can be replayed or forged without going through that UI.
 */
export async function deleteCompany(_prev: FormState, form: FormData): Promise<FormState> {
  const { org, person } = await requireSession();
  if (person.role !== "owner") return { error: "Only the owner can delete the company." };
  if (field(form, "confirmName") !== org.name) return { error: "Type the company name exactly to confirm." };

  await deleteOrganization(org.id);
  await signOut();
  redirect("/");
}
