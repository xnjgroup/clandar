import { NextResponse } from "next/server";
import { api, apiSession } from "@/lib/api";
import { listSchedule } from "@/lib/schedule";
import { listTasks } from "@/lib/tasks";
import { dateInZone, validTimeZone, zonedTimeToUtc } from "@/lib/time-zone";

/**
 * GET ?timeZone=America/New_York → the app's Today: the day's schedule (in that zone) and the open
 * tasks due today or earlier (overdue first), plus open tasks with no date.
 */
export const GET = api(async (request: Request) => {
  const { org } = await apiSession();
  const timeZone = validTimeZone(new URL(request.url).searchParams.get("timeZone"));
  const today = dateInZone(new Date(), timeZone);
  const from = zonedTimeToUtc(today, "00:00", timeZone)!;
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

  const [schedule, tasks] = await Promise.all([listSchedule(org.id, { from, to }), listTasks(org.id)]);
  const due = tasks.filter((t) => !t.isDone && t.dueDate !== null && t.dueDate <= today);
  const undated = tasks.filter((t) => !t.isDone && t.dueDate === null);
  return NextResponse.json({ date: today, timeZone, schedule, due, undated });
});
