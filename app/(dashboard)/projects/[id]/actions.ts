"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { DOC_TYPES, type DocType } from "@/lib/doc-types";
import { markParsePending, parseProjectDocument } from "@/lib/document-ingest";
import { requireSession } from "@/lib/auth";
import { getConnectorForOrg, hasGmailModifyScope } from "@/lib/connectors";
import { getProject } from "@/lib/projects";
import {
  deleteProjectFile,
  deleteProjectFolder,
  ensureProjectFolder,
  getProjectFile,
  getProjectFolder,
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
  formatEstimateEmail,
  getEstimate,
  markEstimateSent,
  type LineItemKind,
} from "@/lib/quoting";
import { sendMail } from "@/lib/gmail";

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

export async function saveEstimate(form: FormData) {
  const projectId = field(form, "projectId");
  const { session } = await requireProject(projectId);
  const summary = field(form, "summary");
  const raw = field(form, "lineItems");
  let lineItems: { description: string; quantity: number; unitPrice: number; kind: LineItemKind }[];
  try {
    lineItems = JSON.parse(raw);
  } catch {
    return;
  }
  await createEstimate({
    orgId: session.org.id,
    projectId,
    summary,
    lineItems,
    aiGenerated: field(form, "aiGenerated") === "true",
    createdBy: session.person.id,
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function removeEstimate(form: FormData) {
  const projectId = field(form, "projectId");
  const { session } = await requireProject(projectId);
  await deleteEstimate(field(form, "estimateId"), session.org.id);
  revalidatePath(`/projects/${projectId}`);
}

export async function sendEstimate(_prev: FormState, form: FormData): Promise<FormState> {
  const projectId = field(form, "projectId");
  const { session, project } = await requireProject(projectId);
  if (!project.customerEmail) return { error: "This customer has no email address on file." };

  const estimate = await getEstimate(field(form, "estimateId"), projectId);
  if (!estimate) return { error: "Estimate not found." };

  const connectorId = field(form, "connectorId");
  const connector = await getConnectorForOrg(connectorId, session.org.id);
  if (!connector) return { error: "Pick a Gmail account to send from." };
  if (!hasGmailModifyScope(connector)) {
    return { error: `${connector.name} needs to reconnect on /connectors to grant permission to send mail.` };
  }

  const { subject, body } = formatEstimateEmail(project, estimate);
  try {
    await sendMail({ orgId: session.org.id, connectorId, to: project.customerEmail, subject, body });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not send the email." };
  }
  await markEstimateSent(estimate.id, session.org.id);
  revalidatePath(`/projects/${projectId}`);
  return { ok: `Sent to ${project.customerEmail}.` };
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
