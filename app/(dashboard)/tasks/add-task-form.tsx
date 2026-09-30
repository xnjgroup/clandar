"use client";

import { TimeZoneField } from "@/components/time-zone-field";
import { useActionState, useEffect, useState } from "react";
import { TASK_KINDS, type TaskKind } from "@/lib/task-kinds";
import { addTask, type FormState } from "./actions";

// One fixed height for every control (iOS gives date inputs their own intrinsic height otherwise).
const inputClass =
  "h-[42px] rounded-[12px] border border-line bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-[5px]">
      <span className="text-[11.5px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * The "New task" dialog's form — on /tasks, and on a project page with
 * `projectId` set. `onAdded` runs after a successful add.
 */
export function AddTaskForm({
  projectId,
  redirectPath,
  defaultKind = "todo",
  members = [],
  onAdded,
}: {
  projectId?: string;
  redirectPath: string;
  defaultKind?: TaskKind;
  members?: { id: string; name: string }[];
  onAdded?: () => void;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(addTask, {});
  // Remounting the form on a successful add clears its (uncontrolled) inputs
  // without fighting useActionState's own state — simpler than a ref + effect.
  const [resetKey, setResetKey] = useState(0);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.ok) setResetKey((k) => k + 1);
  }
  // Tell the parent (e.g. close the dialog) once an add has gone through.
  useEffect(() => {
    if (state.ok) onAdded?.();
  }, [state, onAdded]);

  return (
    <form
      key={resetKey}
      action={action}
      className="flex flex-col gap-[12px]"
    >
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <input type="hidden" name="redirectPath" value={redirectPath} />
      <TimeZoneField />
      <Field label="What needs doing?">
        <input
          name="title"
          required
          autoFocus
          placeholder="e.g. Order tile for the Smith bathroom"
          className={`${inputClass} w-full`}
        />
      </Field>
      <Field label="Type">
        <select name="kind" defaultValue={defaultKind} className={inputClass}>
          {TASK_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Due">
        <input
          name="dueDate"
          type="date"
          aria-label="Due date"
          className={`${inputClass} w-full min-w-0 appearance-none`}
        />
      </Field>
      {members.length > 0 ? (
        <Field label="Assigned to">
          <select name="assignedTo" defaultValue="" className={inputClass}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-[4px] h-[42px] w-full cursor-pointer rounded-full bg-ink px-5 text-[12.5px] font-semibold text-bg disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add task"}
      </button>
      {state.error ? <span className="text-[11.5px] text-bad-fg">{state.error}</span> : null}
    </form>
  );
}
