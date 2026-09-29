"use client";

import { useActionState, useRef } from "react";
import { uploadPhoto, type FormState } from "./actions";

export function PhotoUploadForm({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadPhoto, {});
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      action={(formData) => {
        action(formData);
        if (inputRef.current) inputRef.current.value = "";
      }}
      className="flex flex-wrap items-center gap-[9px]"
    >
      <input type="hidden" name="jobId" value={jobId} />
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept="image/*"
        required
        className="min-w-0 flex-1 text-[12px] text-body-soft file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-ink file:px-3 file:py-[7px] file:text-[11.5px] file:font-semibold file:text-bg"
      />
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 cursor-pointer rounded-full border border-line px-[14px] py-[7px] text-[12px] font-medium disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Upload"}
      </button>
      {state.error ? <span className="text-[11.5px] text-bad-fg">{state.error}</span> : null}
    </form>
  );
}
