"use client";

import { useState } from "react";
import { TimeZoneField } from "@/components/time-zone-field";
import { WEEKDAYS, type Frequency } from "@/lib/data";

const inputClass =
  "rounded-[10px] border border-line bg-surface px-2 py-[7px] text-[12.5px] text-ink outline-none focus:border-[#9aa78a]";

/**
 * When an automation runs — frequency, the weekday for weekly, and the time — as
 * form fields (frequency / runWeekday / runTime, plus the browser's timeZone so
 * "8:00" means 8 AM for whoever set it). Shared by the preset picker, "create
 * your own", and "Change schedule".
 */
export function ScheduleFields({
  frequency: initialFrequency,
  runTime,
  runWeekday,
}: {
  frequency: Frequency;
  runTime: string;
  runWeekday: number | null;
}) {
  const [frequency, setFrequency] = useState<Frequency>(initialFrequency);
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      <TimeZoneField />
      <select
        name="frequency"
        value={frequency}
        onChange={(e) => setFrequency(e.target.value as Frequency)}
        aria-label="How often"
        className={inputClass}
      >
        <option value="daily">Every day</option>
        <option value="weekdays">Weekdays</option>
        <option value="weekly">Once a week</option>
      </select>
      {frequency === "weekly" ? (
        <select name="runWeekday" defaultValue={String(runWeekday ?? 1)} aria-label="Day of the week" className={inputClass}>
          {WEEKDAYS.map((day, i) => (
            <option key={day} value={i}>
              on {day}
            </option>
          ))}
        </select>
      ) : null}
      <span className="text-[12px] text-muted">at</span>
      <input type="time" name="runTime" defaultValue={runTime} required aria-label="Time" className={inputClass} />
    </div>
  );
}
