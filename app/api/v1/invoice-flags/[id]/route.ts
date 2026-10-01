import { NextResponse } from "next/server";
import { api, apiSession, idParam } from "@/lib/api";
import { clearInvoiceFlag } from "@/lib/email-invoice";

type Context = { params: Promise<{ id: string }> };

/** DELETE → clears a flag on an invoice (checked and fine) — flags must be cleared before approving. */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  await clearInvoiceFlag(await idParam(params, "Flag"), org.id);
  return NextResponse.json({ ok: true });
});
