"use client";

import { TimeZoneField } from "@/components/time-zone-field";
import { useActionState } from "react";
import { REPEATS } from "@/lib/task-kinds";
import type { Task } from "@/lib/tasks";
import { saveTask, type FormState } from "../actions";

const inputClass =
  "w-full rounded-[12px] border border-line bg-surface px-3 py-[10px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-[5px] ${wide ? "lg:col-span-2" : ""}`}>
      <span className="text-[11px] text-muted">{label}</span>
      {children}
    </label>
  );
}

/** The shared fields every task has, plus the ones only its kind uses (a shopping list's store, a reminder's time and repeat). */
export function TaskDetailsForm({ task, members }: { task: Task; members: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveTask, {});

  return (
    // Keyed by the saved values: React resets an action form after it submits, and a <select>
    // resets to the option it was first rendered with — without a remount on new values, a saved
    // assignee/repeat would snap back to the old one on screen.
    <form
      key={[task.title, task.notes, task.dueDate, task.remindTime, task.repeat, task.store, task.assignedTo].join("|")}
      action={action}
      className="grid grid-cols-1 gap-[10px] lg:grid-cols-2"
    >
      <input type="hidden" name="id" value={task.id} />
      <TimeZoneField />
      <Field label="Title" wide>
        <input name="title" defaultValue={task.title} required className={inputClass} />
      </Field>

      {task.kind === "reminder" ? (
        <>
          <Field label="Remind me on">
            <input name="dueDate" type="date" defaultValue={task.dueDate ?? ""} className={inputClass} />
          </Field>
          <Field label="At">
            <input name="remindTime" type="time" defaultValue={task.remindTime ?? ""} className={inputClass} />
          </Field>
          <Field label="Repeat">
            <select name="repeat" defaultValue={task.repeat} className={inputClass}>
              {REPEATS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : (
        <Field label={task.kind === "shopping" ? "Need it by" : "Due"}>
          <input name="dueDate" type="date" defaultValue={task.dueDate ?? ""} className={inputClass} />
        </Field>
      )}

      {task.kind === "shopping" ? (
        <Field label="Store">
          <input name="store" defaultValue={task.store} placeholder="e.g. Home Depot" className={inputClass} />
        </Field>
      ) : null}

      <Field label="Assigned to">
        <select name="assignedTo" defaultValue={task.assignedTo ?? ""} className={inputClass}>
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Notes" wide>
        <textarea name="notes" rows={3} defaultValue={task.notes} className={inputClass} />
      </Field>

      <div className="flex items-center gap-[10px] lg:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {state.error ? <span className="text-[11.5px] text-bad-fg">{state.error}</span> : null}
        {state.ok && !pending ? <span className="text-[11.5px] text-muted">{state.ok}</span> : null}
      </div>
    </form>
  );
}
