"use client";

import { useActionState, useState } from "react";
import { addScheduleEntry, type FormState } from "./actions";

const inputClass =
  "rounded-[10px] border border-line bg-surface px-2 py-[7px] text-[12px] text-ink outline-none focus:border-[#9aa78a]";

/** `jobId` fixes the job (used on a job hub page); omit it and pass `jobs` for a picker (the standalone /schedule page). */
export function ScheduleForm({
  jobId,
  jobs,
  members,
  redirectPath,
}: {
  jobId?: string;
  jobs?: { id: string; title: string }[];
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
      <div className="flex flex-wrap items-center gap-[7px]">
        {jobId ? (
          <input type="hidden" name="jobId" value={jobId} />
        ) : (
          <select name="jobId" required defaultValue="" className={`${inputClass} min-w-[160px] flex-1`}>
            <option value="" disabled>
              Select a job…
            </option>
            {jobs?.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        )}
        <input type="date" name="date" required className={inputClass} />
        <input type="time" name="startTime" defaultValue="09:00" className={inputClass} />
        <span className="text-[11px] text-faint">to</span>
        <input type="time" name="endTime" defaultValue="17:00" className={inputClass} />
        {members.length > 0 ? (
          <select name="assignedTo" defaultValue="" className={inputClass}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded-full bg-ink px-4 py-[8px] text-[12px] font-semibold text-bg disabled:opacity-50"
        >
          {pending ? "Scheduling…" : "Schedule"}
        </button>
      </div>
      {state.error ? <span className="text-[11.5px] text-bad-fg">{state.error}</span> : null}
    </form>
  );
}
