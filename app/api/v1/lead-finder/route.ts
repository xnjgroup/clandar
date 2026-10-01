import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { requireOwner } from "@/lib/api-settings";
import { getLeadFinderSettings, saveLeadFinderSettings, type LeadFinderSettings } from "@/lib/lead-finder";

type Editable = Omit<LeadFinderSettings, "lastScanAt" | "lastScanNote" | "lastDigestAt">;

/** GET → { settings } — the lead finder (scans new email for project opportunities) and its daily digest. */
export const GET = api(async () => {
  const { org } = await apiSession();
  return NextResponse.json({ settings: await getLeadFinderSettings(org.id) });
});

/** PUT { …settings } — owner only; same rules as the website's lead finder form. */
export const PUT = api(async (request: Request) => {
  const session = await apiSession();
  requireOwner(session);
  const body = await jsonBody<Partial<Editable>>(request);
  const checkMinutes = Number(body.checkMinutes);
  const minConfidence = Number(body.minConfidence);
  const digestTime = body.digestTime || "07:30";
  if (![15, 30, 60].includes(checkMinutes)) throw new ApiError(400, "Pick how often to check (15, 30 or 60 minutes).");
  if (!(minConfidence >= 0.3 && minConfidence <= 0.95)) throw new ApiError(400, "Pick how strict it should be (0.3–0.95).");
  if (!/^\d{1,2}:\d{2}$/.test(digestTime)) throw new ApiError(400, "Send digestTime as HH:MM.");
  const settings: Editable = {
    isEnabled: body.isEnabled === true,
    checkMinutes: checkMinutes as 15 | 30 | 60,
    minConfidence,
    gmailLabels: body.gmailLabels === true,
    instructions: (body.instructions ?? "").slice(0, 2000),
    digestEnabled: body.digestEnabled === true,
    digestTime,
    timeZone: body.timeZone ?? "UTC",
    digestBell: body.digestBell === true,
    digestPush: body.digestPush === true,
    digestEmail: body.digestEmail === true,
  };
  await saveLeadFinderSettings(session.org.id, settings);
  return NextResponse.json({ settings: await getLeadFinderSettings(session.org.id) });
});
