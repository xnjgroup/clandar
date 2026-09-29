"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { getConnectorForOrg, hasGmailModifyScope } from "@/lib/connectors";
import { getProject } from "@/lib/projects";
import {
  addProjectFile,
  addProjectPhoto,
  deleteProjectFile,
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

export async function uploadPhoto(_prev: FormState, form: FormData): Promise<FormState> {
  const projectId = field(form, "projectId");
  const { session } = await requireProject(projectId);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo first." };
  if (!file.type.startsWith("image/")) return { error: "Only image files are supported." };

  const bytes = Buffer.from(await file.arrayBuffer());
  await addProjectPhoto({ projectId, fileName: file.name, contentType: file.type, bytes, uploadedBy: session.person.id });
  revalidatePath(`/projects/${projectId}`);
  return { ok: "Photo added." };
}

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

export async function uploadFile(_prev: FormState, form: FormData): Promise<FormState> {
  const projectId = field(form, "projectId");
  const { session } = await requireProject(projectId);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file first." };

  const bytes = Buffer.from(await file.arrayBuffer());
  await addProjectFile({
    projectId,
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    bytes,
    uploadedBy: session.person.id,
  });
  revalidatePath(`/projects/${projectId}`);
  return { ok: "File added." };
}

export async function removeFile(form: FormData) {
  const projectId = field(form, "projectId");
  await requireProject(projectId);
  await deleteProjectFile(field(form, "fileId"), projectId);
  revalidatePath(`/projects/${projectId}`);
}
