"use client";

import { useActionState, useEffect, useState } from "react";
import { createFolder, type FormState } from "./actions";

/**
 * Adds a subfolder inside the folder being viewed (`parentId` blank = top
 * level), in the Files card's "New folder" modal. `onAdded` runs once it's made.
 */
export function NewFolderForm({
  projectId,
  parentId,
  parentName,
  onAdded,
}: {
  projectId: string;
  parentId: string;
  parentName?: string | null;
  onAdded?: () => void;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createFolder, {});
  // Same remount-to-clear trick as AddTaskForm.
  const [resetKey, setResetKey] = useState(0);
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.ok) setResetKey((k) => k + 1);
  }
  useEffect(() => {
    if (state.ok) onAdded?.();
  }, [state, onAdded]);

  return (
    <form key={resetKey} action={action} className="flex flex-col gap-[12px]">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="parentId" value={parentId} />
      <label className="flex flex-col gap-[5px]">
        <span className="text-[11.5px] font-medium text-muted">Folder name</span>
        <input
          name="name"
          required
          maxLength={120}
          autoFocus
          placeholder="e.g. Permits, Site photos"
          className="h-[42px] w-full min-w-0 rounded-[12px] border border-line bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]"
        />
      </label>
      <span className="text-[12px] text-muted">
        Inside <span className="font-semibold text-ink">{parentName || "All folders (top level)"}</span>
      </span>
      {state.error ? <span className="text-[12px] text-bad-fg">{state.error}</span> : null}
      <button
        type="submit"
        disabled={pending}
        className="h-[42px] cursor-pointer rounded-full bg-ink text-[12.5px] font-semibold text-bg disabled:opacity-50"
      >
        {pending ? "Adding…" : "Create folder"}
      </button>
    </form>
  );
}
