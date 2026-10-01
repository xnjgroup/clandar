import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody } from "@/lib/api";
import { query } from "@/lib/db";
import { deleteEstimate, setEstimateStatus, type EstimateStatus } from "@/lib/quoting";

type Context = { params: Promise<{ id: string }> };

async function ownEstimate(id: string, orgId: string) {
  const rows = await query<{ id: string }>(`SELECT id FROM estimates WHERE id = $1 AND org_id = $2`, [id, orgId]);
  if (!rows[0]) throw new ApiError(404, "Estimate not found.");
}

/** PATCH { status: "accepted" | "declined" | "draft" | "sent" } — record the customer's answer. */
export const PATCH = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Estimate");
  await ownEstimate(id, org.id);
  const { status } = await jsonBody<{ status?: EstimateStatus }>(request);
  if (!status || !["draft", "sent", "accepted", "declined"].includes(status)) throw new ApiError(400, "Unknown status.");
  await setEstimateStatus(id, org.id, status);
  return NextResponse.json({ ok: true });
});

/** DELETE → removes an estimate. */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Estimate");
  await ownEstimate(id, org.id);
  await deleteEstimate(id, org.id);
  return NextResponse.json({ ok: true });
});
