import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { revokeCurrentSession } from "@/lib/auth";

/** DELETE → signs this device out (ends the session behind its token). */
export const DELETE = api(async () => {
  await revokeCurrentSession();
  return NextResponse.json({ ok: true });
});
