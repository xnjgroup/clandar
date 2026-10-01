import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody, optionalText } from "@/lib/api";
import { deleteCustomer, getCustomer, updateCustomer } from "@/lib/customers";
import { listProjects } from "@/lib/projects";

type Context = { params: Promise<{ id: string }> };

/** GET → { customer, projects }. */
export const GET = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Customer");
  const customer = await getCustomer(id, org.id);
  if (!customer) throw new ApiError(404, "Customer not found.");
  return NextResponse.json({ customer, projects: await listProjects(org.id, { customerId: id }) });
});

/** PATCH { name?, email?, phone?, address?, notes? }. */
export const PATCH = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Customer");
  const customer = await getCustomer(id, org.id);
  if (!customer) throw new ApiError(404, "Customer not found.");
  const body = await jsonBody<Record<string, unknown>>(request);
  const name = optionalText(body.name);
  if (name === "" || name === null) throw new ApiError(400, "The name can't be empty.");
  const pick = (key: string, current: string | null) => {
    const v = optionalText(body[key]);
    return v === undefined ? current : v || null;
  };
  await updateCustomer(id, org.id, {
    name: name ?? customer.name,
    email: pick("email", customer.email),
    phone: pick("phone", customer.phone),
    address: pick("address", customer.address),
    notes: optionalText(body.notes) ?? customer.notes,
  });
  return NextResponse.json({ customer: await getCustomer(id, org.id) });
});

/** DELETE → removes the customer (and their projects). */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Customer");
  if (!(await getCustomer(id, org.id))) throw new ApiError(404, "Customer not found.");
  await deleteCustomer(id, org.id);
  return NextResponse.json({ ok: true });
});
