"use client";

import { useState } from "react";
import type { Frequency } from "@/lib/data";
import { changeScheduledTaskSchedule } from "../actions";
import { ScheduleFields } from "../schedule-fields";

/** "Change schedule" on an automation's page — reveals the schedule picker prefilled with its current timing. */
export function ChangeSchedule({
  id,
  frequency,
  runTime,
  runWeekday,
}: {
  id: string;
  frequency: Frequency;
  runTime: string;
  runWeekday: number | null;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="cursor-pointer text-[11.5px] font-medium underline">
        Change schedule
      </button>
    );
  }
  return (
    <form
      action={async (form) => {
        await changeScheduledTaskSchedule(form);
        setOpen(false);
      }}
      className="flex w-full flex-wrap items-center gap-[8px] rounded-[12px] bg-[#fafbf9] p-[10px]"
    >
      <input type="hidden" name="id" value={id} />
      <ScheduleFields frequency={frequency} runTime={runTime} runWeekday={runWeekday} />
      <button type="submit" className="cursor-pointer rounded-full bg-ink px-[14px] py-[7px] text-[11.5px] font-semibold text-bg">
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="cursor-pointer text-[11.5px] underline">
        Cancel
      </button>
    </form>
  );
}
