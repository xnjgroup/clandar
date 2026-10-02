import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { addDemoData, DEMO_SETS, demoStatus, removeDemoData, type DemoSet } from "@/lib/demo-data";
import { originFromHeaders } from "@/lib/request-origin";

/** GET → { hasDemo, hasOwnData, isEmpty, sets } — whether to offer sample data, or its Remove banner. */
export const GET = api(async () => {
  const { org } = await apiSession();
  return NextResponse.json({ ...(await demoStatus(org.id)), sets: DEMO_SETS });
});

/** POST { sets: ["renovation", "travel"], timeZone } — adds sample data → the new status. */
export const POST = api(async (request: Request) => {
  const session = await apiSession();
  const body = await jsonBody<{ sets?: string[]; timeZone?: string }>(request);
  const sets = (body.sets ?? []).filter((s): s is DemoSet => DEMO_SETS.some((d) => d.id === s));
  if (sets.length === 0) throw new ApiError(400, "Pick at least one sample set.");
  await addDemoData(session.org.id, session.person.id, sets, body.timeZone ?? "UTC", originFromHeaders(request.headers));
  return NextResponse.json({ ...(await demoStatus(session.org.id)), sets: DEMO_SETS });
});

/** DELETE — removes all sample data (the person's own records stay) → the new status. */
export const DELETE = api(async () => {
  const { org } = await apiSession();
  await removeDemoData(org.id);
  return NextResponse.json({ ...(await demoStatus(org.id)), sets: DEMO_SETS });
});
