import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody } from "@/lib/api";
import { automationSchedule } from "@/lib/api-automations";
import {
  deleteScheduledTask,
  getScheduledTask,
  listRuns,
  setScheduledTaskEnabled,
  updateScheduledTaskSchedule,
} from "@/lib/scheduled-tasks";

type Context = { params: Promise<{ id: string }> };

/** GET → { automation, runs } — with its recent runs (the reports). */
export const GET = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Automation");
  const automation = await getScheduledTask(id, org.id);
  if (!automation) throw new ApiError(404, "Automation not found.");
  return NextResponse.json({ automation, runs: await listRuns(id) });
});

/** PATCH { enabled? } and/or a new schedule { frequency, runTime, runWeekday?, timeZone }. */
export const PATCH = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Automation");
  if (!(await getScheduledTask(id, org.id))) throw new ApiError(404, "Automation not found.");
  const body = await jsonBody<{ enabled?: boolean; frequency?: string; runTime?: string; runWeekday?: number | null; timeZone?: string }>(
    request,
  );
  if (typeof body.enabled === "boolean") await setScheduledTaskEnabled(id, org.id, body.enabled);
  if (body.frequency !== undefined) await updateScheduledTaskSchedule(id, org.id, automationSchedule(body));
  return NextResponse.json({ automation: await getScheduledTask(id, org.id) });
});

/** DELETE → removes the automation. */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  await deleteScheduledTask(await idParam(params, "Automation"), org.id);
  return NextResponse.json({ ok: true });
});
