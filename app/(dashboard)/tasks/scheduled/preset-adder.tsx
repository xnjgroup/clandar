"use client";

import { useState } from "react";
import type { Frequency } from "@/lib/data";
import { addPresetTask } from "./actions";
import { ScheduleFields } from "./schedule-fields";

/** A ready-made automation's "Add automation" — opens a schedule picker prefilled with the preset's default. */
export function PresetAdder({
  index,
  frequency,
  runTime,
  runWeekday,
}: {
  index: number;
  frequency: Frequency;
  runTime: string;
  runWeekday: number | null;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit cursor-pointer rounded-full border border-line px-[12px] py-[7px] text-[11.5px] font-medium"
      >
        Add automation
      </button>
    );
  }
  return (
    <form action={addPresetTask.bind(null, index)} className="flex flex-col gap-[8px] rounded-[12px] bg-[#fafbf9] p-[10px]">
      <span className="text-[11.5px] font-medium text-muted">When should it run?</span>
      <ScheduleFields frequency={frequency} runTime={runTime} runWeekday={runWeekday} />
      <div className="flex items-center gap-[8px]">
        <button type="submit" className="cursor-pointer rounded-full bg-ink px-[14px] py-[7px] text-[11.5px] font-semibold text-bg">
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className="cursor-pointer text-[11.5px] underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
