"use client";

import { useActionState } from "react";
import { inviteMember, type FormState } from "./actions";

const inputClass =
  "w-full rounded-[12px] border border-line bg-surface px-3 py-[10px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

export function InviteForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(inviteMember, {});

  return (
    <form action={action} className="flex flex-col gap-[9px]">
      <div className="flex flex-wrap items-end gap-[10px]">
        <label className="flex min-w-[220px] flex-1 flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Email</span>
          <input
            name="email"
            type="email"
            required
            placeholder="crew@example.com"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Role</span>
          <select name="role" defaultValue="crew" className={`${inputClass} w-auto`}>
            <option value="crew">Crew</option>
            <option value="member">Member</option>
            <option value="approver">Approver</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-full bg-ink px-4 py-[10px] text-[12.5px] font-semibold text-bg enabled:cursor-pointer disabled:opacity-50"
        >
          {pending ? "Inviting…" : "Invite"}
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
