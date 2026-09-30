"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { TimeZoneField } from "@/components/time-zone-field";
import { addScheduleEntry, type FormState } from "./actions";

// Fixed height so text, date, time and select fields line up.
const inputClass =
  "h-[42px] w-full min-w-0 rounded-[12px] border border-line bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-[5px] ${className}`}>
      <span className="text-[11.5px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * Add a block to the schedule: what's happening, when, who, and optionally the
 * project it's for. `projectId` fixes the project (on a project page); otherwise
 * `projects` offers an optional picker.
 */
export function ScheduleForm({
  projectId,
  projects,
  members,
  redirectPath,
  onAdded,
}: {
  projectId?: string;
  projects?: { id: string; title: string }[];
  members: { id: string; name: string }[];
  redirectPath: string;
  onAdded?: () => void;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(addScheduleEntry, {});
  useEffect(() => {
    if (state.ok) onAdded?.();
  }, [state, onAdded]);

  return (
    <form action={action} className="flex flex-col gap-[12px]">
      <input type="hidden" name="redirectPath" value={redirectPath} />
      <TimeZoneField />
      <Field label="What's happening">
        <input
          name="notes"
          required={!projectId}
          placeholder={projectId ? "e.g. Demo day, tile install, final walkthrough" : "e.g. Tile install, flight to Nashville"}
          className={inputClass}
        />
      </Field>
      <Field label={projectId ? "Where (optional — leave empty for the project's address)" : "Where (optional)"}>
        <input name="location" placeholder="e.g. 123 Main St, Brooklyn · Home Depot Jersey City" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-[10px]">
        <Field label="Date" className="col-span-2">
          <input type="date" name="date" required className={inputClass} />
        </Field>
        <Field label="From">
          <input type="time" name="startTime" defaultValue="09:00" className={inputClass} />
        </Field>
        <Field label="To">
          <input type="time" name="endTime" defaultValue="17:00" className={inputClass} />
        </Field>
      </div>
      {members.length > 0 ? (
        <Field label="Who">
          <select name="assignedTo" defaultValue="" className={inputClass}>
            <option value="">Anyone</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {projectId ? (
        <input type="hidden" name="projectId" value={projectId} />
      ) : (
        <Field label="Project (optional)">
          <select name="projectId" defaultValue="" className={inputClass}>
            <option value="">No project</option>
            {projects?.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        </Field>
      )}
      {state.error ? <span className="text-[12px] text-bad-fg">{state.error}</span> : null}
      <button
        type="submit"
        disabled={pending}
        className="h-[42px] cursor-pointer rounded-full bg-ink text-[13px] font-semibold text-bg disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add to schedule"}
      </button>
    </form>
  );
}
