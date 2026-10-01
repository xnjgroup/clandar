import { NextResponse } from "next/server";
import { api, apiSession } from "@/lib/api";
import { getLeadFinderSettings, listLeads } from "@/lib/lead-finder";

/** GET ?handled=true → { leads, enabled, lastScanAt } — the lead finder's queue (open, or handled). */
export const GET = api(async (request: Request) => {
  const { org } = await apiSession();
  const handled = new URL(request.url).searchParams.get("handled") === "true";
  const [leads, settings] = await Promise.all([listLeads(org.id, { handled }), getLeadFinderSettings(org.id)]);
  return NextResponse.json({ leads, enabled: settings.isEnabled, lastScanAt: settings.lastScanAt });
});
