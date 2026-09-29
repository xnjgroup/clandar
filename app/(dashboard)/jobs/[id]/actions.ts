"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { getConnectorForOrg, hasGmailModifyScope } from "@/lib/connectors";
import { getJob } from "@/lib/jobs";
import { addJobFile, addJobPhoto, deleteJobFile, deleteJobPhoto, listJobPhotos } from "@/lib/job-photos";
import {
  analyzeJobPhotos,
  createEstimate,
  deleteEstimate,
  formatEstimateEmail,
  getEstimate,
  markEstimateSent,
  type LineItemKind,
} from "@/lib/quoting";
import { sendMail } from "@/lib/gmail";

export type FormState = { error?: string; ok?: string };
export type AnalyzeState = { error?: string; proposal?: Awaited<ReturnType<typeof analyzeJobPhotos>> };

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function requireJob(id: string) {
  const session = await requireSession();
  const job = await getJob(id, session.org.id);
  if (!job) throw new Error("Job not found");
  return { session, job };
}

/* ── Photos ───────────────────────────────────────────────── */

export async function uploadPhoto(_prev: FormState, form: FormData): Promise<FormState> {
  const jobId = field(form, "jobId");
  const { session } = await requireJob(jobId);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo first." };
  if (!file.type.startsWith("image/")) return { error: "Only image files are supported." };

  const bytes = Buffer.from(await file.arrayBuffer());
  await addJobPhoto({ jobId, fileName: file.name, contentType: file.type, bytes, uploadedBy: session.person.id });
  revalidatePath(`/jobs/${jobId}`);
  return { ok: "Photo added." };
}

export async function removePhoto(form: FormData) {
  const jobId = field(form, "jobId");
  await requireJob(jobId);
  await deleteJobPhoto(field(form, "photoId"), jobId);
  revalidatePath(`/jobs/${jobId}`);
}

export async function analyzePhotos(_prev: AnalyzeState, form: FormData): Promise<AnalyzeState> {
  const jobId = field(form, "jobId");
  try {
    const { session, job } = await requireJob(jobId);
    const photos = await listJobPhotos(jobId);
    const proposal = await analyzeJobPhotos(
      session.org.id,
      { title: job.title, trade: job.trade, address: job.address, notes: job.notes },
      photos,
    );
    return { proposal };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not analyze the photos." };
  }
}

/* ── Estimates ────────────────────────────────────────────── */

export async function saveEstimate(form: FormData) {
  const jobId = field(form, "jobId");
  const { session } = await requireJob(jobId);
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
    jobId,
    summary,
    lineItems,
    aiGenerated: field(form, "aiGenerated") === "true",
    createdBy: session.person.id,
  });
  revalidatePath(`/jobs/${jobId}`);
}

export async function removeEstimate(form: FormData) {
  const jobId = field(form, "jobId");
  const { session } = await requireJob(jobId);
  await deleteEstimate(field(form, "estimateId"), session.org.id);
  revalidatePath(`/jobs/${jobId}`);
}

export async function sendEstimate(_prev: FormState, form: FormData): Promise<FormState> {
  const jobId = field(form, "jobId");
  const { session, job } = await requireJob(jobId);
  if (!job.customerEmail) return { error: "This customer has no email address on file." };

  const estimate = await getEstimate(field(form, "estimateId"), jobId);
  if (!estimate) return { error: "Estimate not found." };

  const connectorId = field(form, "connectorId");
  const connector = await getConnectorForOrg(connectorId, session.org.id);
  if (!connector) return { error: "Pick a Gmail account to send from." };
  if (!hasGmailModifyScope(connector)) {
    return { error: `${connector.name} needs to reconnect on /connectors to grant permission to send mail.` };
  }

  const { subject, body } = formatEstimateEmail(job, estimate);
  try {
    await sendMail({ orgId: session.org.id, connectorId, to: job.customerEmail, subject, body });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not send the email." };
  }
  await markEstimateSent(estimate.id, session.org.id);
  revalidatePath(`/jobs/${jobId}`);
  return { ok: `Sent to ${job.customerEmail}.` };
}

/* ── Files ────────────────────────────────────────────────── */

export async function uploadFile(_prev: FormState, form: FormData): Promise<FormState> {
  const jobId = field(form, "jobId");
  const { session } = await requireJob(jobId);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file first." };

  const bytes = Buffer.from(await file.arrayBuffer());
  await addJobFile({
    jobId,
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    bytes,
    uploadedBy: session.person.id,
  });
  revalidatePath(`/jobs/${jobId}`);
  return { ok: "File added." };
}

export async function removeFile(form: FormData) {
  const jobId = field(form, "jobId");
  await requireJob(jobId);
  await deleteJobFile(field(form, "fileId"), jobId);
  revalidatePath(`/jobs/${jobId}`);
}
