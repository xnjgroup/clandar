"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { getConnectorForOrg } from "@/lib/connectors";
import { enqueueTrashLabel } from "@/lib/queue";

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Enqueues a bulk trash for one label — runs in the background (see
 * lib/gmail-cleanup-worker.ts), so this returns immediately and the page
 * polls `bulkTrashStatus` for progress rather than waiting here.
 */
export async function startTrashLabel(form: FormData) {
  const { org, person } = await requireSession();
  const connectorId = field(form, "connectorId");
  const label = field(form, "label");
  // A destructive action against a user-supplied connector id — verify it's
  // actually this org's connector before ever touching a real inbox.
  const connector = await getConnectorForOrg(connectorId, org.id);
  if (!connector) return;
  await enqueueTrashLabel(connectorId, label, person.id);
  revalidatePath("/email");
}
