"use client";

import { useActionState, useState } from "react";
import { addProjectType, type FormState } from "./actions";
import { ICON_OPTIONS, iconSelectClass, inputClass } from "./icon-options";

export function NewProjectTypeForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addProjectType, {});
  const [resetKey, setResetKey] = useState(0);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (!state.error) setResetKey((k) => k + 1);
  }

  return (
    <form key={resetKey} action={action} className="flex flex-wrap items-center gap-[8px]">
      <input name="name" required placeholder="e.g. Kitchen remodel" className={`${inputClass} min-w-[180px] flex-1`} />
      <select name="icon" defaultValue="briefcase" className={iconSelectClass}>
        {ICON_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
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
