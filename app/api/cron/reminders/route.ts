import { NextResponse } from "next/server";
import { runLeadDigests, runLeadFinder } from "@/lib/lead-finder";
import { fireDueReminders } from "@/lib/reminders";

/**
 * Fires due reminders and runs the lead finder + its daily digests — for hosts without the in-process 5-minute tick
 * (Vercel). Call it every few minutes from Vercel Cron, which sends
 * "Authorization: Bearer $CRON_SECRET" automatically, or from any external
 * scheduler sending that same header. Safe to call alongside the tick: each
 * reminder is claimed atomically, so it's only ever sent once.
 */
// A lead scan reads mail and asks the email AI, which can take a while.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const appUrl = new URL(request.url).origin;
  const fired = await fireDueReminders({ appUrl });
  // Same cadence suits the lead finder (it tracks each org's own 15/30/60-minute interval) and its daily digests.
  const leadScans = await runLeadFinder().catch(() => 0);
  const leadDigests = await runLeadDigests(appUrl).catch(() => 0);
  return NextResponse.json({ fired, leadScans, leadDigests });
}
