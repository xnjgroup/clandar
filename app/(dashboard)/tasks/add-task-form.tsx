"use client";

import { TimeZoneField } from "@/components/time-zone-field";
import { useActionState, useState } from "react";
import { TASK_KINDS, type TaskKind } from "@/lib/task-kinds";
import { addTask, type FormState } from "./actions";

const inputClass =
  "rounded-[12px] border border-line bg-surface px-3 py-[9px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

/** Shared between /tasks (no `projectId`) and a project hub page (`projectId` set, `kind` optionally locked). */
export function AddTaskForm({
  projectId,
  redirectPath,
  defaultKind = "todo",
  members = [],
}: {
  projectId?: string;
  redirectPath: string;
  defaultKind?: TaskKind;
  members?: { id: string; name: string }[];
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

  return (
    // Phones: the title gets its own full-width line, then a 2-column grid of kind / due / assignee / Add.
    // Wider screens: one wrapping row (the grid wrapper dissolves via sm:contents).
    <form key={resetKey} action={action} className="flex flex-col gap-[8px] sm:flex-row sm:flex-wrap sm:items-center">
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <input type="hidden" name="redirectPath" value={redirectPath} />
      <TimeZoneField />
      <input
        name="title"
        required
        placeholder="What needs doing?"
        className={`${inputClass} w-full sm:w-auto sm:min-w-[180px] sm:flex-1`}
      />
      <div className="grid grid-cols-2 gap-[8px] sm:contents">
        <select name="kind" defaultValue={defaultKind} className={inputClass}>
          {TASK_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        {/* Labelled: an empty date field is a blank box on iOS Safari. */}
        <label className={`${inputClass} flex min-w-0 items-center gap-[6px] py-0`}>
          <span className="shrink-0 text-[11.5px] text-muted">Due</span>
          <input name="dueDate" type="date" className="min-w-0 flex-1 bg-transparent py-[9px] text-ink outline-none" />
        </label>
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
          className={`cursor-pointer rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg disabled:opacity-50 ${
            members.length > 0 ? "" : "col-span-2"
          }`}
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {state.error ? <span className="text-[11.5px] text-bad-fg">{state.error}</span> : null}
    </form>
  );
}
