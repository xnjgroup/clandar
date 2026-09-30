"use client";

import { useActionState, useState } from "react";
import { TimeZoneField } from "@/components/time-zone-field";
import { addScheduleEntry, type FormState } from "./actions";

// Fixed height so text, date, time and select fields line up.
const inputClass =
  "h-[38px] min-w-0 rounded-[10px] border border-line bg-surface px-[10px] text-[12px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

/** `projectId` fixes the project (used on a project hub page); omit it and pass `projects` for a picker (the standalone /schedule page). */
export function ScheduleForm({
  projectId,
  projects,
  members,
  redirectPath,
}: {
  projectId?: string;
  projects?: { id: string; title: string }[];
  members: { id: string; name: string }[];
  redirectPath: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(addScheduleEntry, {});
  const [resetKey, setResetKey] = useState(0);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.ok) setResetKey((k) => k + 1);
  }

  return (
    <form key={resetKey} action={action} className="flex flex-col gap-[8px]">
      <input type="hidden" name="redirectPath" value={redirectPath} />
      <TimeZoneField />
      {projectId ? (
        <input type="hidden" name="projectId" value={projectId} />
      ) : (
        <select name="projectId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Select a project…
          </option>
          {projects?.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
            </option>
          ))}
        </select>
      )}
      <input name="notes" placeholder="What's happening — e.g. Demo day, tile install, final walkthrough" className={inputClass} />
      {/* Phones: date + who on one row, the time window on the next. Wider: all on one row. */}
      <div className="grid grid-cols-2 gap-[7px] sm:flex sm:flex-wrap sm:items-center">
        <input type="date" name="date" required aria-label="Date" className={`${inputClass} sm:w-[150px]`} />
        {members.length > 0 ? (
          <select name="assignedTo" defaultValue="" aria-label="Who" className={`${inputClass} sm:order-last sm:w-[150px]`}>
            <option value="">Anyone</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="col-span-2 flex items-center gap-[7px]">
          <input type="time" name="startTime" defaultValue="09:00" aria-label="Start" className={`${inputClass} flex-1 sm:w-[110px] sm:flex-none`} />
          <span className="text-[11px] text-faint">to</span>
          <input type="time" name="endTime" defaultValue="17:00" aria-label="End" className={`${inputClass} flex-1 sm:w-[110px] sm:flex-none`} />
        </div>
      </div>
      <div className="flex items-center gap-[10px]">
        <button
          type="submit"
          disabled={pending}
          className="h-[38px] cursor-pointer rounded-full bg-ink px-5 text-[12px] font-semibold text-bg disabled:opacity-50"
        >
          {pending ? "Scheduling…" : "Schedule"}
        </button>
        {state.error ? <span className="text-[11.5px] text-bad-fg">{state.error}</span> : null}
      </div>
    </form>
  );
}
