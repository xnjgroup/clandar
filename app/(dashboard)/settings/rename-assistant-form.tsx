"use client";

import { useActionState } from "react";
import { renameAssistant, type FormState } from "./actions";

/** Settings → Chat: what the team calls its assistant — one word, up to 10 characters. */
export function RenameAssistantForm({ currentName }: { currentName: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(renameAssistant, {});

  return (
    <form action={action} className="flex flex-wrap items-end gap-[10px]">
      <label className="flex min-w-[160px] flex-1 flex-col gap-[5px]">
        <span className="text-[11px] text-muted">Assistant&rsquo;s name — one word, up to 10 characters</span>
        <input
          name="name"
          defaultValue={currentName}
          required
          maxLength={10}
          pattern="[\p{L}\p{N}]{1,10}"
          title="One word — letters and numbers only, up to 10 characters"
          autoComplete="off"
          className="w-full rounded-[12px] border border-line bg-surface px-3 py-[9px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 cursor-pointer rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {state.error ? <span className="text-[11.5px] text-bad-fg">{state.error}</span> : null}
      {state.ok ? <span className="text-[11.5px] text-ok-fg">{state.ok}</span> : null}
    </form>
  );
}
