import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { createCustomer, listCustomers } from "@/lib/customers";

/** GET ?q= → { customers } (search by name, email, phone). */
export const GET = api(async (request: Request) => {
  const { org } = await apiSession();
  const q = new URL(request.url).searchParams.get("q")?.trim();
  return NextResponse.json({ customers: await listCustomers(org.id, q || undefined) });
});

/** POST { name, email?, phone?, address?, notes? } → { id }. */
export const POST = api(async (request: Request) => {
  const { org } = await apiSession();
  const body = await jsonBody<{ name?: string; email?: string; phone?: string; address?: string; notes?: string }>(request);
  const name = body.name?.trim();
  if (!name) throw new ApiError(400, "Give the customer a name.");
  const id = await createCustomer({
    orgId: org.id,
    name,
    email: body.email?.trim() || null,
    phone: body.phone?.trim() || null,
    address: body.address?.trim() || null,
    notes: body.notes?.trim() ?? "",
  });
  return NextResponse.json({ id }, { status: 201 });
});
