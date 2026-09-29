"use client";

import { useActionState, useState } from "react";
import { createFolder, type FormState } from "./actions";

/** Adds a subfolder inside the folder being viewed (`parentId` blank = top level). */
export function NewFolderForm({ projectId, parentId }: { projectId: string; parentId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createFolder, {});
  // Same remount-to-clear trick as AddTaskForm.
  const [resetKey, setResetKey] = useState(0);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.ok) setResetKey((k) => k + 1);
  }

  return (
    <form key={resetKey} action={action} className="flex flex-wrap items-center gap-[8px]">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="parentId" value={parentId} />
      <input
        name="name"
        required
        maxLength={120}
        placeholder="New folder name"
        className="min-w-[160px] flex-1 rounded-[12px] border border-line bg-surface px-3 py-[7px] text-[12px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]"
      />
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 cursor-pointer rounded-full border border-line px-[14px] py-[7px] text-[12px] font-medium disabled:opacity-50"
      >
        {pending ? "Adding…" : "New folder"}
      </button>
      {state.error ? <span className="text-[11.5px] text-bad-fg">{state.error}</span> : null}
    </form>
  );
}
