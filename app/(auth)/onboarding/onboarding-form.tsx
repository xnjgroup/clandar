"use client";

import { useActionState } from "react";
import { COMPANY_TYPES } from "@/lib/data";
import { finishOnboarding, type FormState } from "./actions";

export function OnboardingForm({ suggestedName }: { suggestedName: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(finishOnboarding, {});

  return (
    <form action={action} className="flex w-full flex-col gap-[14px]">
      <label className="flex flex-col gap-[6px] text-left">
        <span className="text-[12px] font-medium text-body-soft">Company name</span>
        <input
          name="name"
          defaultValue={suggestedName}
          required
          autoFocus
          placeholder="Fei John Home Improvement LLC"
          className="w-full rounded-[12px] border border-line bg-surface px-3 py-[11px] text-[14px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]"
        />
      </label>
      <label className="flex flex-col gap-[6px] text-left">
        <span className="text-[12px] font-medium text-body-soft">What kind of business is this?</span>
        <select
          name="companyType"
          required
          defaultValue=""
          className="w-full rounded-[12px] border border-line bg-surface px-3 py-[11px] text-[14px] text-ink outline-none focus:border-[#9aa78a]"
        >
          <option value="" disabled>
            Select one…
          </option>
          {COMPANY_TYPES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-faint">
          Sets up a starter list of project types for you — fully editable afterward.
        </span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-full cursor-pointer rounded-full bg-ink px-5 py-[12px] text-[14px] font-semibold text-bg enabled:cursor-pointer disabled:opacity-50"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
      {state.error ? (
        <p className="m-0 rounded-[12px] bg-bad-bg px-3 py-2 text-[12px] leading-[1.5] text-bad-fg">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
