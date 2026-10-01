import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody, UUID } from "@/lib/api";
import { scheduleFields, type ScheduleBody } from "@/lib/api-schedule";
import { listUpcomingReminders } from "@/lib/reminders";
import { createScheduleEntry, listSchedule, locateScheduleEntries } from "@/lib/schedule";
import { after } from "next/server";

const DAY = 24 * 60 * 60 * 1000;

/**
 * GET ?from=ISO&to=ISO&who=personId → { entries, reminders } — defaults to the next 30 days. Entries
 * still missing map coordinates are looked up after the response (the next load has them).
 */
export const GET = api(async (request: Request) => {
  const { org } = await apiSession();
  const params = new URL(request.url).searchParams;
  const parse = (v: string | null, fallback: Date) => {
    const d = v ? new Date(v) : fallback;
    return Number.isNaN(d.getTime()) ? fallback : d;
  };
  const from = parse(params.get("from"), new Date(Date.now() - DAY));
  const to = parse(params.get("to"), new Date(Date.now() + 30 * DAY));
  const who = params.get("who");
  const filters = who && UUID.test(who) ? { assignedTo: who } : {};
  const [entries, reminders] = await Promise.all([
    listSchedule(org.id, { from, to }, filters),
    listUpcomingReminders(org.id, to, filters),
  ]);
  if (entries.some((e) => e.lat === null && (e.location || e.projectAddress))) {
    after(() => locateScheduleEntries(org.id, entries));
  }
  return NextResponse.json({ entries, reminders });
});

/** POST { notes, location?, startsAt, endsAt, assignedTo?, projectId? } → { id }. Needs notes or a project. */
export const POST = api(async (request: Request) => {
  const { org } = await apiSession();
  const fields = await scheduleFields(org.id, await jsonBody<ScheduleBody>(request));
  if (!fields.startsAt || !fields.endsAt) throw new ApiError(400, "Pick a date and time.");
  if (!fields.notes && !fields.projectId) throw new ApiError(400, "Say what's happening.");
  const id = await createScheduleEntry({
    orgId: org.id,
    projectId: fields.projectId ?? null,
    assignedTo: fields.assignedTo ?? null,
    startsAt: fields.startsAt,
    endsAt: fields.endsAt,
    notes: fields.notes ?? "",
    location: fields.location ?? "",
  });
  return NextResponse.json({ id }, { status: 201 });
});
