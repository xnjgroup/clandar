import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody } from "@/lib/api";
import { deleteScheduleEntry, getScheduleEntry, updateScheduleEntry } from "@/lib/schedule";
import { scheduleFields, type ScheduleBody } from "@/lib/api-schedule";

type Context = { params: Promise<{ id: string }> };

/** PATCH — any of { notes, location, startsAt+endsAt, assignedTo, projectId }; a new place is looked up again. */
export const PATCH = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Schedule entry");
  const fields = await scheduleFields(org.id, await jsonBody<ScheduleBody>(request));
  if (!(await updateScheduleEntry(id, org.id, fields))) throw new ApiError(404, "Schedule entry not found.");
  return NextResponse.json({ entry: await getScheduleEntry(id, org.id) });
});

/** DELETE → removes the entry. */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Schedule entry");
  if (!(await getScheduleEntry(id, org.id))) throw new ApiError(404, "Schedule entry not found.");
  await deleteScheduleEntry(id, org.id);
  return NextResponse.json({ ok: true });
});
