import { NextResponse } from "next/server";
import { api, ApiError, apiSession } from "@/lib/api";
import { gmailFailure, resolveAccount } from "@/lib/api-email";
import { readMail } from "@/lib/gmail";
import { getLeadForMessage } from "@/lib/lead-finder";

type Context = { params: Promise<{ id: string }> };

/**
 * GET ?account= → { message, lead } — the full email (html is the sender's untrusted HTML: render it
 * with scripts off), its attachments (bytes: /api/email/{id}/attachments/{partId}?account=), and the
 * lead finder's read of it, if it flagged one.
 */
export const GET = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const { id } = await params;
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new ApiError(404, "Email not found.");
  const account = await resolveAccount(org.id, new URL(request.url).searchParams.get("account"));
  try {
    const message = await readMail(id, org.id, account.id);
    const lead = await getLeadForMessage(id, org.id);
    return NextResponse.json({ message, lead });
  } catch (error) {
    gmailFailure(error);
  }
});
