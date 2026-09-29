"use client";

import { useActionState, useState } from "react";
import { WEEKDAYS, type Frequency } from "@/lib/data";
import { addScheduledTask, type FormState } from "./actions";

const inputClass =
  "w-full rounded-[12px] border border-line bg-surface px-3 py-[10px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

export function NewScheduledTaskForm({ onCancel }: { onCancel: () => void }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addScheduledTask, {});
  const [frequency, setFrequency] = useState<Frequency>("daily");

  return (
    <form action={action} className="flex flex-col gap-[13px]">
      <div className="grid grid-cols-1 gap-[10px] lg:grid-cols-2">
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Name</span>
          <input name="name" required placeholder="Monday morning check-in" className={inputClass} />
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Short description (optional)</span>
          <input name="description" placeholder="What this task is for" className={inputClass} />
        </label>
        <label className="flex flex-col gap-[5px] lg:col-span-2">
          <span className="text-[11px] text-muted">What should it do?</span>
          <textarea
            name="prompt"
            required
            rows={3}
            placeholder="Summarize anything overdue and what's scheduled for tomorrow."
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Frequency</span>
          <select
            name="frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Frequency)}
            className={inputClass}
          >
            <option value="daily">Every day</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        {frequency === "weekly" ? (
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11px] text-muted">Day</span>
            <select name="runWeekday" defaultValue="5" className={inputClass}>
              {WEEKDAYS.map((day, i) => (
                <option key={day} value={i}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Time (UTC)</span>
          <input type="time" name="runTime" defaultValue="08:00" className={inputClass} />
        </label>
      </div>

      <div className="flex items-center gap-[10px]">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg enabled:cursor-pointer disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create task"}
        </button>
        <button type="button" onClick={onCancel} className="cursor-pointer text-[11.5px] font-medium underline">
          Cancel
        </button>
      </div>

      {state.error ? (
        <p className="m-0 rounded-[12px] bg-bad-bg px-3 py-2 text-[12px] leading-[1.5] text-bad-fg">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
