"use client";

import { TimeZoneField } from "@/components/time-zone-field";
import { useActionState, useEffect, useState } from "react";
import { TASK_KINDS, type TaskKind } from "@/lib/task-kinds";
import { addTask, type FormState } from "./actions";

// One fixed height for every control (iOS gives date inputs their own intrinsic height otherwise).
const inputClass =
  "h-[42px] rounded-[12px] border border-line bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

function Field({ label, stacked, children }: { label: string; stacked: boolean; children: React.ReactNode }) {
  if (!stacked) return <>{children}</>;
  return (
    <label className="flex min-w-0 flex-col gap-[5px]">
      <span className="text-[11.5px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * Shared between /tasks (in the "New task" dialog, `layout="stacked"`) and a
 * project hub page (inline, `projectId` set). `onAdded` runs after a successful add.
 */
export function AddTaskForm({
  projectId,
  redirectPath,
  defaultKind = "todo",
  members = [],
  layout = "inline",
  onAdded,
}: {
  projectId?: string;
  redirectPath: string;
  defaultKind?: TaskKind;
  members?: { id: string; name: string }[];
  layout?: "inline" | "stacked";
  onAdded?: () => void;
}) {
  const stacked = layout === "stacked";
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
      className={stacked ? "flex flex-col gap-[12px]" : "flex flex-wrap items-center gap-[8px]"}
    >
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <input type="hidden" name="redirectPath" value={redirectPath} />
      <TimeZoneField />
      <Field label="What needs doing?" stacked={stacked}>
        <input
          name="title"
          required
          autoFocus={stacked}
          placeholder={stacked ? "e.g. Order tile for the Smith bathroom" : "What needs doing?"}
          className={`${inputClass} ${stacked ? "w-full" : "min-w-[180px] flex-1"}`}
        />
      </Field>
      <Field label="Type" stacked={stacked}>
        <select name="kind" defaultValue={defaultKind} className={inputClass}>
          {TASK_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Due" stacked={stacked}>
        <input
          name="dueDate"
          type="date"
          aria-label="Due date"
          className={`${inputClass} min-w-0 appearance-none ${stacked ? "w-full" : ""}`}
        />
      </Field>
      {members.length > 0 ? (
        <Field label="Assigned to" stacked={stacked}>
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
        className={`h-[42px] cursor-pointer rounded-full bg-ink px-5 text-[12.5px] font-semibold text-bg disabled:opacity-50 ${
          stacked ? "mt-[4px] w-full" : ""
        }`}
      >
        {pending ? "Adding…" : stacked ? "Add task" : "Add"}
      </button>
      {state.error ? <span className="text-[11.5px] text-bad-fg">{state.error}</span> : null}
    </form>
  );
}
