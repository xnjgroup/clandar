"use client";

import { useActionState, useState } from "react";
import { CardTitle } from "@/components/ui";
import { addCustomer, type FormState } from "./actions";

const inputClass =
  "w-full rounded-[12px] border border-line bg-surface px-3 py-[10px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

export function AddCustomerForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addCustomer, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-[10px]">
        <CardTitle>Customers</CardTitle>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto shrink-0 cursor-pointer rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg"
        >
          + Add customer
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-[13px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <CardTitle>New customer</CardTitle>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto shrink-0 cursor-pointer text-[11.5px] font-medium underline"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 gap-[10px] lg:grid-cols-2">
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Name</span>
          <input name="name" required placeholder="Jordan Alvarez" className={inputClass} />
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Phone</span>
          <input name="phone" type="tel" placeholder="(555) 010-1234" className={inputClass} />
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Email</span>
          <input name="email" type="email" placeholder="jordan@example.com" className={inputClass} />
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Address</span>
          <input name="address" placeholder="123 Maple St, Springfield" className={inputClass} />
        </label>
        <label className="flex flex-col gap-[5px] lg:col-span-2">
          <span className="text-[11px] text-muted">Notes</span>
          <textarea name="notes" rows={2} placeholder="How they found us, preferences, gate code…" className={inputClass} />
        </label>
      </div>

      <div className="flex items-center gap-[9px]">
        <button
          type="submit"
          disabled={pending}
          className="ml-auto shrink-0 rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg enabled:cursor-pointer disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save customer"}
        </button>
      </div>

      {state.error ? (
        <p className="m-0 rounded-[12px] bg-bad-bg px-3 py-2 text-[12px] leading-[1.5] text-bad-fg">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
