import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam } from "@/lib/api";
import { getScheduledTask } from "@/lib/scheduled-tasks";
import { enqueueRunNow } from "@/lib/scheduled-tasks-queue";

type Context = { params: Promise<{ id: string }> };

/** POST → "Run now": runs it in the background; the report arrives in the chat like a scheduled run. */
export const POST = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Automation");
  if (!(await getScheduledTask(id, org.id))) throw new ApiError(404, "Automation not found.");
  await enqueueRunNow(id, org.id);
  return NextResponse.json({ ok: true }, { status: 202 });
});
