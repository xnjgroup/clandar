import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { deletePushSubscription, pushConfigured, savePushSubscription, type PushSubscriptionJson } from "@/lib/push";

/** POST a browser PushSubscription (as JSON) → this browser gets reminder notifications. */
export async function POST(request: Request) {
  const { person } = await requireSession();
  if (!pushConfigured()) return NextResponse.json({ error: "Push isn't configured on this server." }, { status: 400 });
  const sub = (await request.json().catch(() => null)) as PushSubscriptionJson | null;
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }
  await savePushSubscription(person.id, sub);
  return NextResponse.json({ ok: true });
}

/** DELETE { endpoint } → stop pushing to that browser. */
export async function DELETE(request: Request) {
  const { person } = await requireSession();
  const body = (await request.json().catch(() => ({}))) as { endpoint?: unknown };
  if (typeof body.endpoint === "string") await deletePushSubscription(person.id, body.endpoint);
  return NextResponse.json({ ok: true });
}
