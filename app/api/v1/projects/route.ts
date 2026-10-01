import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody, UUID, YMD } from "@/lib/api";
import { getCustomer } from "@/lib/customers";
import { createProject, listProjects, projectCountsByStatus, PROJECT_STATUSES, type ProjectStatus } from "@/lib/projects";

/** GET ?status=&customerId= → { projects, counts } (counts per status, for the filter chips). */
export const GET = api(async (request: Request) => {
  const { org } = await apiSession();
  const params = new URL(request.url).searchParams;
  const status = params.get("status") as ProjectStatus | null;
  const customerId = params.get("customerId");
  const [projects, counts] = await Promise.all([
    listProjects(org.id, {
      status: status && PROJECT_STATUSES.some((s) => s.id === status) ? status : undefined,
      customerId: customerId && UUID.test(customerId) ? customerId : undefined,
    }),
    projectCountsByStatus(org.id),
  ]);
  return NextResponse.json({ projects, counts });
});

/** POST { customerId, title, projectTypeId?, address?, notes?, dueDate? } → { id }. */
export const POST = api(async (request: Request) => {
  const { org, person } = await apiSession();
  const body = await jsonBody<{
    customerId?: string;
    title?: string;
    projectTypeId?: string | null;
    address?: string;
    notes?: string;
    dueDate?: string | null;
  }>(request);
  const title = body.title?.trim();
  if (!title) throw new ApiError(400, "Give the project a title.");
  if (!body.customerId || !UUID.test(body.customerId)) throw new ApiError(400, "Pick a customer.");
  const customer = await getCustomer(body.customerId, org.id);
  if (!customer) throw new ApiError(400, "That customer wasn't found.");
  const id = await createProject({
    orgId: org.id,
    customerId: customer.id,
    title,
    projectTypeId: body.projectTypeId && UUID.test(body.projectTypeId) ? body.projectTypeId : null,
    // Blank address → the customer's, like the web form.
    address: body.address?.trim() || customer.address || "",
    notes: body.notes?.trim() ?? "",
    dueDate: body.dueDate && YMD.test(body.dueDate) ? body.dueDate : null,
    createdBy: person.id,
  });
  return NextResponse.json({ id }, { status: 201 });
});
