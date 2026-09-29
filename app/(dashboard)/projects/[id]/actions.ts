"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { DOC_TYPES, type DocType } from "@/lib/doc-types";
import { markParsePending, parseProjectDocument } from "@/lib/document-ingest";
import { requireSession } from "@/lib/auth";
import { getConnectorForOrg, hasGmailModifyScope } from "@/lib/connectors";
import { getProject, setProjectStatus } from "@/lib/projects";
import {
  deleteProjectFile,
  deleteProjectFolder,
  ensureProjectFolder,
  getProjectFile,
  getProjectFolder,
  getProjectPhoto,
  readProjectFileBytes,
  readProjectPhotoBytes,
  moveProjectFile,
  parseTags,
  renameProjectFolder,
  setProjectFileDocType,
  setProjectFileTags,
  deleteProjectPhoto,
  listProjectPhotos,
} from "@/lib/project-photos";
import {
  analyzeProjectPhotos,
  createEstimate,
  deleteEstimate,
  getEstimate,
  markEstimateSent,
  setEstimateStatus,
  syncTasksFromEstimate,
  updateEstimate,
  type LineItemKind,
} from "@/lib/quoting";
import { renderEstimateEmail } from "@/lib/estimate-email";
import { sendMail, type OutgoingAttachment } from "@/lib/gmail";
import { cleanLetterhead, saveLetterhead } from "@/lib/letterhead";
import { validTimeZone } from "@/lib/tasks";

export type FormState = { error?: string; ok?: string };
export type AnalyzeState = { error?: string; proposal?: Awaited<ReturnType<typeof analyzeProjectPhotos>> };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function requireProject(id: string) {
  const session = await requireSession();
  const project = await getProject(id, session.org.id);
  if (!project) throw new Error("Project not found");
  return { session, project };
}

/* ── Photos ───────────────────────────────────────────────── */

export async function removePhoto(form: FormData) {
  const projectId = field(form, "projectId");
  await requireProject(projectId);
  await deleteProjectPhoto(field(form, "photoId"), projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function analyzePhotos(_prev: AnalyzeState, form: FormData): Promise<AnalyzeState> {
  const projectId = field(form, "projectId");
  try {
    const { session, project } = await requireProject(projectId);
    const photos = await listProjectPhotos(projectId);
    const proposal = await analyzeProjectPhotos(
      session.org.id,
      {
        title: project.title,
        projectType: project.projectTypeName ?? "general",
        address: project.address,
        notes: project.notes,
      },
      photos,
    );
    return { proposal };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not analyze the photos." };
  }
}

/* ── Estimates ────────────────────────────────────────────── */

/**
 * Saves the line editor: creates an estimate, or with `estimateId` updates that
 * draft. Returns an error instead of throwing so the editor stays on screen to fix.
 */
export async function saveEstimate(form: FormData): Promise<FormState> {
  const projectId = field(form, "projectId");
  const { session } = await requireProject(projectId);
  const summary = field(form, "summary");
  let parsed: unknown;
  try {
    parsed = JSON.parse(field(form, "lineItems"));
  } catch {
    return { error: "Couldn't read the line items." };
  }
  if (!Array.isArray(parsed)) return { error: "Couldn't read the line items." };
  const kinds: LineItemKind[] = ["labor", "material", "other"];
  const lineItems = parsed
    .map((l: { description?: unknown; quantity?: unknown; unitPrice?: unknown; kind?: unknown }) => ({
      description: typeof l.description === "string" ? l.description.trim() : "",
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      kind: kinds.includes(l.kind as LineItemKind) ? (l.kind as LineItemKind) : "other",
    }))
    .filter((l) => l.description);
  if (lineItems.length === 0) return { error: "Add at least one line with a description." };
  if (lineItems.some((l) => !Number.isFinite(l.quantity) || !Number.isFinite(l.unitPrice) || l.quantity < 0 || l.unitPrice < 0)) {
    return { error: "Quantities and prices must be zero or more." };
  }

  const estimateId = field(form, "estimateId");
  try {
    if (estimateId) {
      // Scoped to this project as well as the org, so an id from another project can't be edited through this one.
      if (!(await getEstimate(estimateId, projectId))) return { error: "Estimate not found." };
      const updated = await updateEstimate(estimateId, session.org.id, { summary, lineItems });
      if (!updated) return { error: "Only a draft can be edited — this one has already been sent." };
    } else {
      await createEstimate({
        orgId: session.org.id,
        projectId,
        summary,
        lineItems,
        aiGenerated: field(form, "aiGenerated") === "true",
        createdBy: session.person.id,
      });
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't save the estimate." };
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: estimateId ? "Estimate updated." : "Estimate saved." };
}

export async function removeEstimate(form: FormData) {
  const projectId = field(form, "projectId");
  const { session } = await requireProject(projectId);
  await deleteEstimate(field(form, "estimateId"), session.org.id);
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Records the customer's answer on a sent estimate (or undoes it back to "sent").
 * Accepting also moves a project that's still a lead/quoted on to "scheduled".
 */
export async function answerEstimate(form: FormData) {
  const projectId = field(form, "projectId");
  const { session, project } = await requireProject(projectId);
  const estimate = await getEstimate(field(form, "estimateId"), projectId);
  const answer = field(form, "answer");
  if (!estimate || estimate.status === "draft" || !["accepted", "declined", "sent"].includes(answer)) return;
  await setEstimateStatus(estimate.id, session.org.id, answer as "accepted" | "declined" | "sent");
  if (answer === "accepted" && (project.status === "lead" || project.status === "quoted")) {
    await setProjectStatus(projectId, session.org.id, "scheduled");
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
}

/** "Create tasks from quote" / "Regenerate tasks" on an accepted estimate — see syncTasksFromEstimate. */
export async function convertEstimateToTasks(form: FormData) {
  const projectId = field(form, "projectId");
  const { session } = await requireProject(projectId);
  await syncTasksFromEstimate({
    estimateId: field(form, "estimateId"),
    projectId,
    orgId: session.org.id,
    createdBy: session.person.id,
    timeZone: validTimeZone(field(form, "timeZone")),
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath("/tasks");
}

/** Combined attachment cap — Gmail allows 25MB per message after base64 grows it by about a third. */
const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;

/**
 * Sends an estimate from the review dialog. The email is re-rendered here
 * from the saved estimate (renderEstimateEmail) — only the editable parts
 * (to, subject, message, company header) and the chosen attachment ids come
 * from the form, and every attachment id is checked against this project.
 */
export async function sendEstimate(_prev: FormState, form: FormData): Promise<FormState> {
  const projectId = field(form, "projectId");
  const { session, project } = await requireProject(projectId);

  const to = field(form, "to");
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) return { error: "Enter one valid email address to send to." };
  const subject = field(form, "subject");
  if (!subject) return { error: "Add a subject." };

  const estimate = await getEstimate(field(form, "estimateId"), projectId);
  if (!estimate) return { error: "Estimate not found." };

  const connectorId = field(form, "connectorId");
  const connector = await getConnectorForOrg(connectorId, session.org.id);
  if (!connector) return { error: "Pick a Gmail account to send from." };
  if (!hasGmailModifyScope(connector)) {
    return { error: `${connector.name} needs to reconnect on /connectors to grant permission to send mail.` };
  }

  const letterhead = cleanLetterhead({
    companyName: form.get("companyName"),
    address: form.get("address"),
    phone: form.get("phone"),
    email: form.get("email"),
    website: form.get("website"),
    license: form.get("license"),
  } as Record<string, unknown>);

  const attachments: OutgoingAttachment[] = [];
  for (const id of form.getAll("fileId")) {
    const file = typeof id === "string" ? await getProjectFile(id, projectId) : null;
    if (!file) return { error: "One of the chosen files is no longer on this project." };
    attachments.push({ fileName: file.fileName, contentType: file.contentType, bytes: await readProjectFileBytes(file) });
  }
  let photoNumber = 0;
  for (const id of form.getAll("photoId")) {
    const photo = typeof id === "string" ? await getProjectPhoto(id, projectId) : null;
    if (!photo) return { error: "One of the chosen photos is no longer on this project." };
    const ext = photo.contentType.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "jpg";
    attachments.push({
      fileName: `photo-${++photoNumber}.${ext}`,
      contentType: photo.contentType,
      bytes: await readProjectPhotoBytes(photo),
    });
  }
  if (attachments.reduce((sum, a) => sum + a.bytes.byteLength, 0) > MAX_ATTACHMENT_BYTES) {
    return { error: "Attachments add up to more than 18 MB — Gmail would reject the message. Remove some." };
  }

  const { html, text } = renderEstimateEmail({
    letterhead,
    message: field(form, "message"),
    projectTitle: project.title,
    estimate,
    attachmentNames: attachments.map((a) => a.fileName),
  });
  try {
    await sendMail({ orgId: session.org.id, connectorId, to, subject, body: text, html, attachments });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not send the email." };
  }

  if (field(form, "saveLetterhead") === "true") await saveLetterhead(session.org.id, letterhead);
  await markEstimateSent(estimate.id, session.org.id);
  revalidatePath(`/projects/${projectId}`);
  return { ok: `Sent to ${to}.` };
}

/* ── Files ────────────────────────────────────────────────── */

export async function removeFile(form: FormData) {
  const projectId = field(form, "projectId");
  await requireProject(projectId);
  await deleteProjectFile(field(form, "fileId"), projectId);
  revalidatePath(`/projects/${projectId}`);
}

/** Checks a folder id from a form belongs to the project; blank means the top level. */
async function folderOrTop(projectId: string, folderId: string): Promise<string | null | undefined> {
  if (!folderId) return null;
  return (await getProjectFolder(folderId, projectId)) ? folderId : undefined;
}

export async function createFolder(_prev: FormState, form: FormData): Promise<FormState> {
  const projectId = field(form, "projectId");
  await requireProject(projectId);
  const name = field(form, "name");
  if (!name) return { error: "Name the folder." };
  const parentId = await folderOrTop(projectId, field(form, "parentId"));
  if (parentId === undefined) return { error: "That folder no longer exists." };
  await ensureProjectFolder(projectId, parentId, name);
  revalidatePath(`/projects/${projectId}`);
  return { ok: "Folder added." };
}

export async function renameFolder(form: FormData) {
  const projectId = field(form, "projectId");
  await requireProject(projectId);
  const name = field(form, "name").replace(/[/\\]/g, "-").slice(0, 120);
  // A clash with a sibling's name trips the unique index; leave the old name in place then.
  if (name) await renameProjectFolder(field(form, "folderId"), projectId, name).catch(() => {});
  revalidatePath(`/projects/${projectId}`);
}

export async function removeFolder(form: FormData) {
  const projectId = field(form, "projectId");
  await requireProject(projectId);
  await deleteProjectFolder(field(form, "folderId"), projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function moveFile(form: FormData) {
  const projectId = field(form, "projectId");
  await requireProject(projectId);
  const folderId = await folderOrTop(projectId, field(form, "folderId"));
  if (folderId !== undefined) await moveProjectFile(field(form, "fileId"), projectId, folderId);
  revalidatePath(`/projects/${projectId}`);
}

export async function tagFile(form: FormData) {
  const projectId = field(form, "projectId");
  await requireProject(projectId);
  await setProjectFileTags(field(form, "fileId"), projectId, parseTags(field(form, "tags")));
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Changes what a file is. Switching to invoice/receipt reads it into an
 * invoice record in the background (unless one was already made from it).
 */
export async function changeFileDocType(form: FormData) {
  const projectId = field(form, "projectId");
  const { session } = await requireProject(projectId);
  const fileId = field(form, "fileId");
  const value = field(form, "docType");
  if (!DOC_TYPES.some((d) => d.id === value)) return;
  await setProjectFileDocType(fileId, projectId, value as DocType);
  const file = await getProjectFile(fileId, projectId);
  if (file && value !== "general" && !file.invoice) {
    await markParsePending(fileId);
    after(() => parseProjectDocument(fileId, projectId, session.org.id));
  }
  revalidatePath(`/projects/${projectId}`);
}

/** Retries a failed invoice/receipt parse. */
export async function reparseFile(form: FormData) {
  const projectId = field(form, "projectId");
  const { session } = await requireProject(projectId);
  const fileId = field(form, "fileId");
  const file = await getProjectFile(fileId, projectId);
  if (file && file.docType !== "general" && !file.invoice) {
    await markParsePending(fileId);
    after(() => parseProjectDocument(fileId, projectId, session.org.id));
  }
  revalidatePath(`/projects/${projectId}`);
}
