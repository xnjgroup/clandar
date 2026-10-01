import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody } from "@/lib/api";
import { deleteTaskItem, setTaskItemDone } from "@/lib/tasks";

type Context = { params: Promise<{ id: string }> };

/** PATCH { done } → ticks a step / shopping item. */
export const PATCH = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Item");
  const { done } = await jsonBody<{ done?: boolean }>(request);
  if (typeof done !== "boolean") throw new ApiError(400, "Send { done: true | false }.");
  await setTaskItemDone(id, org.id, done);
  return NextResponse.json({ ok: true });
});

/** DELETE → removes a step / shopping item. */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Item");
  await deleteTaskItem(id, org.id);
  return NextResponse.json({ ok: true });
});
