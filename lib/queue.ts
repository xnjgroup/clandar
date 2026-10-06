/**
 * Gmail background work — inbox scans and bulk trash — as jobs on the Postgres queue (lib/jobs.ts),
 * run by a job runner (lib/job-runner.ts). A scan's results land in Postgres (`cleanup_scans` /
 * `cleanup_candidates`); a job's live `{ done, total }` progress is on the job row, streamed to the
 * browser by `app/api/gmail-jobs/[jobId]/route.ts`.
 */
import { createHash } from "node:crypto";
import { activeJobs, enqueueJob, getJob, setJobControl as setControl } from "@/lib/jobs";

const GMAIL_KINDS = ["analyze-inbox", "trash-label", "trash-search"];

async function orgOf(connectorId: string): Promise<string | null> {
  const { getConnector } = await import("@/lib/connectors");
  return (await getConnector(connectorId))?.orgId ?? null;
}

export async function enqueueInboxAnalysis(connectorId: string, maxMessages = 2_000, label: string | null = null) {
  return enqueueJob({ kind: "analyze-inbox", orgId: await orgOf(connectorId), payload: { connectorId, maxMessages, label }, maxAttempts: 2 });
}

export function bulkTrashJobId(connectorId: string, label: string) {
  return `trash-label-${label}-${connectorId}`;
}

/** A bulk trash for one label — asking again while it runs returns the same job. */
export async function enqueueTrashLabel(connectorId: string, label: string, requestedBy?: string) {
  return enqueueJob({ kind: "trash-label", id: bulkTrashJobId(connectorId, label), orgId: await orgOf(connectorId), payload: { connectorId, label, requestedBy } });
}

/** One job id per account + search, so asking twice while it runs doesn't start a duplicate. */
export function trashSearchJobId(connectorId: string, query: string) {
  return `trash-search-${createHash("sha1").update(query).digest("hex").slice(0, 16)}-${connectorId}`;
}

export async function enqueueTrashSearch(connectorId: string, query: string, requestedBy?: string) {
  return enqueueJob({ kind: "trash-search", id: trashSearchJobId(connectorId, query), orgId: await orgOf(connectorId), payload: { connectorId, query, requestedBy } });
}

export type RunningTrash = { jobId: string; connectorId: string } & ({ kind: "trash-label"; label: string } | { kind: "trash-search"; query: string });

/** Bulk trashes still queued or running — for the assistant's Updates. */
export async function runningTrashJobs(): Promise<RunningTrash[]> {
  const jobs = await activeJobs(["trash-label", "trash-search"]);
  return jobs.map((job) => {
    const p = job.payload as { connectorId: string; label?: string; query?: string };
    return job.kind === "trash-label"
      ? { jobId: job.id, connectorId: p.connectorId, kind: "trash-label" as const, label: p.label ?? "" }
      : { jobId: job.id, connectorId: p.connectorId, kind: "trash-search" as const, query: p.query ?? "" };
  });
}

/** BullMQ's state names, kept so the progress UI didn't have to change. */
export type JobStatus = {
  state: "waiting" | "active" | "completed" | "failed" | string;
  done: number;
  total: number;
  error: string | null;
  paused?: boolean;
};

export type JobControl = "pause" | "cancel";

export async function setJobControl(jobId: string, control: JobControl | null): Promise<void> {
  await setControl(jobId, control);
}

export async function jobStatus(jobId: string): Promise<JobStatus | null> {
  const job = await getJob(jobId);
  if (!job || !GMAIL_KINDS.includes(job.kind)) return null;
  const state = job.status === "queued" ? "waiting" : job.status === "running" ? "active" : job.status === "cancelled" ? "completed" : job.status;
  return { state, done: job.progress.done ?? 0, total: job.progress.total ?? 0, error: job.status === "failed" ? (job.error ?? "Unknown error") : null, paused: job.progress.paused ?? false };
}

/** Which connector a job belongs to — so the progress stream can check it's the viewer's org's. */
export async function jobConnectorId(jobId: string): Promise<string | null> {
  const job = await getJob(jobId);
  return job && GMAIL_KINDS.includes(job.kind) ? ((job.payload as { connectorId?: string }).connectorId ?? null) : null;
}

export async function bulkTrashStatus(connectorId: string, label: string): Promise<JobStatus | null> {
  return jobStatus(bulkTrashJobId(connectorId, label));
}
