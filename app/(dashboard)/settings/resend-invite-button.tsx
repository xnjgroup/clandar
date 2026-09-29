"use client";

import { useActionState } from "react";
import { resendInvite, type FormState } from "./actions";

/** "Resend" on a pending invite — emails the sign-in link again and says how it went. */
export function ResendInviteButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resendInvite, {});
  return (
    <form action={action} className="flex items-center gap-[8px]">
      <input type="hidden" name="id" value={id} />
      {state.error ? <span className="max-w-[320px] text-[11px] text-bad-fg">{state.error}</span> : null}
      {state.ok ? <span className="text-[11px] text-ok-fg">{state.ok}</span> : null}
      <button
        type="submit"
        disabled={pending}
        className="cursor-pointer text-[11.5px] font-medium underline disabled:opacity-50"
      >
        {pending ? "Sending…" : "Resend"}
      </button>
    </form>
  );
}
