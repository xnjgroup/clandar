import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody } from "@/lib/api";
import { addTaskItem, getTask, listTaskItems } from "@/lib/tasks";

type Context = { params: Promise<{ id: string }> };

/** POST { label, quantity?, unit?, unitPrice?, url? } → adds a step / shopping item; returns the items. */
export const POST = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Task");
  if (!(await getTask(id, org.id))) throw new ApiError(404, "Task not found.");
  const body = await jsonBody<{ label?: string; quantity?: number | null; unit?: string; unitPrice?: number | null; url?: string | null }>(request);
  const label = body.label?.trim();
  if (!label) throw new ApiError(400, "Say what the item is.");
  const url = body.url && /^https?:\/\//i.test(body.url) ? body.url : null;
  await addTaskItem(id, org.id, {
    label,
    quantity: typeof body.quantity === "number" && body.quantity > 0 ? body.quantity : null,
    unit: body.unit?.trim() ?? "",
    url,
    unitPrice: typeof body.unitPrice === "number" && body.unitPrice >= 0 ? body.unitPrice : null,
  });
  return NextResponse.json({ items: await listTaskItems(id, org.id) }, { status: 201 });
});
