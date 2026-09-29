"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getConnectorForOrg } from "@/lib/connectors";
import { dismissCandidates, trashCandidates } from "@/lib/gmail-cleanup";
import { enqueueInboxAnalysis } from "@/lib/queue";

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function candidateIds(form: FormData) {
  return form.getAll("candidateId").filter((v): v is string => typeof v === "string");
}

function path(connectorId: string) {
  return `/email/cleanup?account=${connectorId}`;
}

function back(connectorId: string, notice: string): never {
  redirect(`${path(connectorId)}&notice=${encodeURIComponent(notice)}`);
}

/** Enqueues a scan for the worker to pick up — see lib/gmail-cleanup-worker.ts. */
export async function startInboxScan(form: FormData) {
  const { org } = await requireSession();
  const connectorId = field(form, "connectorId");
  const label = field(form, "label");
  if (!(await getConnectorForOrg(connectorId, org.id))) return;
  await enqueueInboxAnalysis(connectorId, undefined, label || null);
  revalidatePath(path(connectorId));
}

export async function dismissSelected(form: FormData) {
  const { org } = await requireSession();
  const connectorId = field(form, "connectorId");
  const ids = candidateIds(form);
  if (!(await getConnectorForOrg(connectorId, org.id))) return;
  if (ids.length === 0) back(connectorId, "Select at least one message first.");
  await dismissCandidates(ids);
  revalidatePath(path(connectorId));
}

/** Moves the selected candidates to Gmail Trash — reversible, never a permanent delete. */
export async function trashSelected(form: FormData) {
  const { org } = await requireSession();
  const connectorId = field(form, "connectorId");
  const ids = candidateIds(form);
  if (!(await getConnectorForOrg(connectorId, org.id))) return;
  if (ids.length === 0) back(connectorId, "Select at least one message first.");

  let result;
  try {
    result = await trashCandidates(connectorId, ids);
  } catch (error) {
    back(connectorId, error instanceof Error ? error.message : "Could not trash the selected messages.");
  }

  revalidatePath(path(connectorId));
  back(
    connectorId,
    result.failed.length === 0
      ? `Moved ${result.trashed} message${result.trashed === 1 ? "" : "s"} to Trash.`
      : `Trashed ${result.trashed}, but ${result.failed.length} failed: ${result.failed[0].error}`,
  );
}
