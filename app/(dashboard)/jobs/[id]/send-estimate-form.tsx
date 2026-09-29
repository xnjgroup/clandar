"use client";

import { useActionState } from "react";
import { sendEstimate, type FormState } from "./actions";

export function SendEstimateForm({
  jobId,
  estimateId,
  connectors,
  customerEmail,
}: {
  jobId: string;
  estimateId: string;
  connectors: { id: string; label: string }[];
  customerEmail: string | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(sendEstimate, {});

  if (!customerEmail) {
    return <span className="text-[11px] text-faint">No customer email on file</span>;
  }
  if (connectors.length === 0) {
    return <span className="text-[11px] text-faint">Connect a Gmail account to send</span>;
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-[7px]">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="estimateId" value={estimateId} />
      <select
        name="connectorId"
        defaultValue={connectors[0].id}
        className="rounded-[10px] border border-line bg-surface px-2 py-[6px] text-[11.5px] text-ink"
      >
        {connectors.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="cursor-pointer rounded-full bg-ink px-3 py-[6px] text-[11.5px] font-semibold text-bg disabled:opacity-50"
      >
        {pending ? "Sending…" : `Send to ${customerEmail}`}
      </button>
      {state.error ? <span className="text-[11px] text-bad-fg">{state.error}</span> : null}
      {state.ok ? <span className="text-[11px] text-ok-fg">{state.ok}</span> : null}
    </form>
  );
}
