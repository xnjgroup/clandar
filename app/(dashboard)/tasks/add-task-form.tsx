"use client";

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
    <form key={resetKey} action={action} className="flex flex-wrap items-center gap-[8px]">
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <input type="hidden" name="redirectPath" value={redirectPath} />
      <select name="kind" defaultValue={defaultKind} className={inputClass}>
        {TASK_KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>
      <input
        name="title"
        required
        placeholder="What needs doing?"
        className={`${inputClass} min-w-[180px] flex-1`}
      />
      <input name="dueDate" type="date" className={inputClass} />
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
        className="cursor-pointer rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      {state.error ? <span className="text-[11.5px] text-bad-fg">{state.error}</span> : null}
    </form>
  );
}
