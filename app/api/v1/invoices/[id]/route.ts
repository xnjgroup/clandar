import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody, UUID } from "@/lib/api";
import { setInvoiceProject, setInvoiceStatus } from "@/lib/email-invoice";
import { invoiceDetail } from "@/lib/queries";

type Context = { params: Promise<{ id: string }> };

/**
 * GET /invoices/{vendor-slug}?id={invoiceId} → { invoice } — the detail the website shows at
 * /invoices/{slug} (line-item groups, flags, account, dates, linked project). Without id: the vendor's latest.
 */
export const GET = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const { id: slug } = await params;
  const invoiceId = new URL(request.url).searchParams.get("id");
  const invoice = await invoiceDetail(org.id, slug, invoiceId && UUID.test(invoiceId) ? invoiceId : undefined);
  if (!invoice) throw new ApiError(404, "Invoice not found.");
  return NextResponse.json({ invoice });
});

/** PATCH /invoices/{invoiceId} { status?: "approved" | "rejected" | "pending_review", projectId?: string | null }. */
export const PATCH = api(async (request: Request, { params }: Context) => {
  const { org, person } = await apiSession();
  const { id } = await params;
  if (!UUID.test(id)) throw new ApiError(404, "Invoice not found.");
  const body = await jsonBody<{ status?: string; projectId?: string | null }>(request);
  if (body.status !== undefined) {
    if (!["approved", "rejected", "pending_review"].includes(body.status)) throw new ApiError(400, "Unknown status.");
    const problem = await setInvoiceStatus(id, org.id, body.status as "approved" | "rejected" | "pending_review", person.id);
    if (problem) throw new ApiError(problem === "Invoice not found." ? 404 : 409, problem);
  }
  if (body.projectId !== undefined) {
    await setInvoiceProject(id, org.id, body.projectId && UUID.test(body.projectId) ? body.projectId : null);
  }
  return NextResponse.json({ ok: true });
});
