/**
 * Time-zone helpers for anything that happens at "9:00 in the user's day":
 * reminders, schedule entries from the assistant, automations. The server may
 * run in UTC (Vercel), so wall-clock times are always converted with the
 * user's IANA zone, captured from their browser.
 */

/** The IANA zone if the runtime knows it (so Postgres' AT TIME ZONE will too), else UTC. */
export function validTimeZone(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

/** The calendar date ("YYYY-MM-DD") that `instant` falls on in `timeZone`. */
export function dateInZone(instant: Date, timeZone: string): string {
  return instant.toLocaleDateString("en-CA", { timeZone: validTimeZone(timeZone) });
}

/** Minutes that `timeZone` is ahead of UTC at `instant`. */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** "2026-10-03" + "09:30" as wall-clock time in `timeZone` → the UTC instant. Null on malformed input. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const naive = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  // Two passes settle the offset across a DST boundary.
  let guess = naive - zoneOffsetMinutes(new Date(naive), zone) * 60_000;
  guess = naive - zoneOffsetMinutes(new Date(guess), zone) * 60_000;
  return new Date(guess);
}
