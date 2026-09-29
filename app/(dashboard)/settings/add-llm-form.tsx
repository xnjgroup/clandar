"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/icons";
import { CardTitle } from "@/components/ui";
import { addLlmProvider, type FormState } from "./actions";

const inputClass =
  "w-full rounded-[12px] border border-line bg-surface px-3 py-[10px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

export function AddLlmForm({ hasAny }: { hasAny: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addLlmProvider, {});
  const [open, setOpen] = useState(false);
  const [makeDefault, setMakeDefault] = useState(false);

  // A successful save collapses the form back to the button — the new row
  // already appeared in the table below.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.ok) {
      setOpen(false);
      setMakeDefault(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-[10px]">
        <CardTitle>LLM providers</CardTitle>
        <span className="text-[11.5px] text-muted">
          Any OpenAI-compatible endpoint — OpenAI itself, or a local server like LM Studio
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto shrink-0 cursor-pointer rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg"
        >
          + Add provider
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-[13px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <CardTitle>Add an LLM provider</CardTitle>
        <span className="text-[11.5px] text-muted">
          The endpoint is listed for its available models as soon as you save
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto shrink-0 cursor-pointer text-[11.5px] font-medium underline"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 gap-[10px] lg:grid-cols-4">
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Name</span>
          <input name="name" required placeholder="LM Studio (desktop)" className={inputClass} />
        </label>

        <label className="flex flex-col gap-[5px] lg:col-span-3">
          <span className="text-[11px] text-muted">Base URL</span>
          <input
            name="baseUrl"
            type="url"
            required
            inputMode="url"
            placeholder="http://100.94.50.121:1234/v1"
            className={`${inputClass} font-mono`}
          />
        </label>

        <label className="flex flex-col gap-[5px] lg:col-span-3">
          <span className="text-[11px] text-muted">API key (optional)</span>
          <input
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder="leave blank if the server doesn't check one"
            className={inputClass}
          />
        </label>

        <label className="flex items-center gap-2 self-end pb-[10px] text-[12.5px]">
          <input
            type="checkbox"
            name="makeDefault"
            value="true"
            checked={makeDefault}
            onChange={(e) => setMakeDefault(e.target.checked)}
            className="size-[15px] cursor-pointer accent-ink"
          />
          Make this the default
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-[9px]">
        <Icon name="shield" size={15} className="shrink-0 text-ok-fg" />
        <span className="text-[11.5px] leading-[1.5] text-muted">
          {hasAny
            ? "The API key, if any, is encrypted before it's written to Postgres."
            : "This becomes the default provider automatically, since it's the first one."}
        </span>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto shrink-0 rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg enabled:cursor-pointer disabled:opacity-50"
        >
          {pending ? "Testing…" : "Save & test connection"}
        </button>
      </div>

      {state.error ? (
        <p className="m-0 rounded-[12px] bg-bad-bg px-3 py-2 text-[12px] leading-[1.5] text-bad-fg">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="m-0 rounded-[12px] bg-ok-bg px-3 py-2 text-[12px] leading-[1.5] text-ok-fg">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}
