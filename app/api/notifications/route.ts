import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { listNotifications, markNotificationsRead } from "@/lib/notifications";

/** GET → the signed-in person's latest notifications + unread count (the header bell polls this). */
export async function GET() {
  const { person } = await requireSession();
  return NextResponse.json(await listNotifications(person.id));
}

/** POST { id? } → marks one notification read, or all of them without an id. */
export async function POST(request: Request) {
  const { person } = await requireSession();
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  await markNotificationsRead(person.id, typeof body.id === "string" ? body.id : undefined);
  return NextResponse.json({ ok: true });
}
