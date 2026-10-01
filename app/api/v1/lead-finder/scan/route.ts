import { NextResponse } from "next/server";
import { api, ApiError, apiSession } from "@/lib/api";
import { scanOrgForLeads } from "@/lib/lead-finder";

// A scan reads new email with AI — it can take a while.
export const maxDuration = 300;

/** POST → "Scan now" → { message } with how many emails were checked and leads found. */
export const POST = api(async () => {
  const { org } = await apiSession();
  try {
    const { checked, found } = await scanOrgForLeads(org.id);
    return NextResponse.json({
      message: `Checked ${checked} new email${checked === 1 ? "" : "s"} — found ${found} lead${found === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    throw new ApiError(502, error instanceof Error ? error.message : "Scan failed.");
  }
});
