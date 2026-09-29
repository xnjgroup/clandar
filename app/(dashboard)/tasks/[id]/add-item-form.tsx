"use client";

import { useActionState, useState } from "react";
import { addItem, type FormState } from "../actions";

const inputClass =
  "rounded-[12px] border border-line bg-surface px-3 py-[9px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

/** Adds a checklist step (to-do) or a shopping item with quantity and unit — either with an optional reference link. */
export function AddItemForm({ taskId, shopping }: { taskId: string; shopping: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addItem, {});
  // Same remount-to-clear trick as AddTaskForm.
  const [resetKey, setResetKey] = useState(0);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.ok) setResetKey((k) => k + 1);
  }

  return (
    <form key={resetKey} action={action} className="flex flex-wrap items-center gap-[8px]">
      <input type="hidden" name="taskId" value={taskId} />
      <input
        name="label"
        autoFocus={resetKey > 0}
        placeholder={shopping ? "Item, e.g. 2x4 lumber" : "Add a step"}
        className={`${inputClass} min-w-[180px] flex-1`}
      />
      {shopping ? (
        <>
          <input name="quantity" type="number" step="any" min="0" placeholder="Qty" className={`${inputClass} w-[80px]`} />
          <input name="unit" placeholder="Unit" className={`${inputClass} w-[90px]`} />
        </>
      ) : null}
      <input
        name="url"
        type="text"
        inputMode="url"
        placeholder="Link (optional)"
        className={`${inputClass} min-w-[140px] flex-1 sm:max-w-[240px]`}
      />
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
