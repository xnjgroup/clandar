import { NextResponse } from "next/server";
import { runDueWork } from "@/lib/job-runner";

/**
 * The minute tick for when no runner is online (lib/job-runner.ts): due reminders, lead finder,
 * scheduled automations — and short queued jobs within the time limit. Call it every minute from a
 * Vercel Cron (Pro) or any external pinger with `Authorization: Bearer $CRON_SECRET` (or ?key=).
 * Safe alongside runners: the tick runs once a minute no matter how many call it.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(request.url).searchParams.get("key");
  if (!secret || given !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runDueWork(45_000);
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
