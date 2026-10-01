import { ApiError } from "@/lib/api";
import type { Frequency } from "@/lib/data";

/** A schedule from a request body, validated (like the web's scheduleFrom). */
export function automationSchedule(body: { frequency?: string; runTime?: string; runWeekday?: number | null; timeZone?: string }) {
  const frequency = body.frequency as Frequency;
  const runTime = body.runTime || "08:00";
  if (!["daily", "weekdays", "weekly"].includes(frequency)) throw new ApiError(400, "Pick daily, weekdays or weekly.");
  if (!/^\d{1,2}:\d{2}$/.test(runTime)) throw new ApiError(400, "Send runTime as HH:MM.");
  const runWeekday = frequency === "weekly" ? Number(body.runWeekday) : null;
  if (frequency === "weekly" && !(Number.isInteger(runWeekday) && runWeekday! >= 0 && runWeekday! <= 6)) {
    throw new ApiError(400, "Pick a day of the week (0 = Sunday … 6 = Saturday).");
  }
  return { frequency, runTime, runWeekday, timeZone: body.timeZone ?? "UTC" };
}
