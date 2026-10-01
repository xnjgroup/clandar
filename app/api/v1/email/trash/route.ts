import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { resolveAccount } from "@/lib/api-email";
import { hasGmailModifyScope } from "@/lib/connectors";
import { BULK_TRASH_LABELS } from "@/lib/gmail-cleanup";
import { enqueueTrashLabel } from "@/lib/queue";

/**
 * POST { account, label: "SPAM" | "CATEGORY_PROMOTIONS" | … } → "Trash all" for that label, as the same
 * background job the website starts (progress, pause / cancel and a done notification in Updates).
 */
export const POST = api(async (request: Request) => {
  const { org, person } = await apiSession();
  const body = await jsonBody<{ account?: string; label?: string }>(request);
  if (!BULK_TRASH_LABELS.some((l) => l.id === body.label)) throw new ApiError(400, "That label can't be bulk-trashed.");
  const account = await resolveAccount(org.id, body.account ?? null);
  if (!hasGmailModifyScope(account)) throw new ApiError(403, "This account only has read access — reconnect it on the website.");
  if (!process.env.REDIS_URL) throw new ApiError(503, "Background jobs aren't set up on this server.");
  await enqueueTrashLabel(account.id, body.label!, person.id);
  return NextResponse.json({ ok: true }, { status: 202 });
});
