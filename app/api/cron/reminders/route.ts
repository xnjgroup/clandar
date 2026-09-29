import { NextResponse } from "next/server";
import { fireDueReminders } from "@/lib/reminders";

/**
 * Fires due reminders — for hosts without the in-process 5-minute tick
 * (Vercel). Call it every few minutes from Vercel Cron, which sends
 * "Authorization: Bearer $CRON_SECRET" automatically, or from any external
 * scheduler sending that same header. Safe to call alongside the tick: each
 * reminder is claimed atomically, so it's only ever sent once.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const fired = await fireDueReminders({ appUrl: new URL(request.url).origin });
  return NextResponse.json({ fired });
}
