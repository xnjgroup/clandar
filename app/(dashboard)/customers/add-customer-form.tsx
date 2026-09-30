"use client";

import { useActionState } from "react";
import { Icon } from "@/components/icons";
import { ModalDialog } from "@/components/modal-dialog";
import { headerIconClass } from "@/components/ui";
import { addCustomer, type FormState } from "./actions";

const inputClass =
  "h-[42px] w-full min-w-0 rounded-[12px] border border-line bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-[5px]">
      <span className="text-[11.5px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/** The New customer form; saving opens the new customer's page (the action redirects). */
function AddCustomerForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addCustomer, {});
  return (
    <form action={action} className="flex flex-col gap-[12px]">
      <Field label="Name">
        <input name="name" required autoFocus placeholder="Jordan Alvarez" className={inputClass} />
      </Field>
      <Field label="Phone">
        <input name="phone" type="tel" placeholder="(555) 010-1234" className={inputClass} />
      </Field>
      <Field label="Email">
        <input name="email" type="email" placeholder="jordan@example.com" className={inputClass} />
      </Field>
      <Field label="Address">
        <input name="address" placeholder="123 Maple St, Springfield" className={inputClass} />
      </Field>
      <Field label="Notes">
        <textarea
          name="notes"
          rows={2}
          placeholder="How they found us, preferences, gate code…"
          className={`${inputClass} h-auto py-[10px]`}
        />
      </Field>
      {state.error ? <span className="text-[12px] text-bad-fg">{state.error}</span> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-[4px] h-[42px] w-full cursor-pointer rounded-full bg-ink text-[12.5px] font-semibold text-bg disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save customer"}
      </button>
    </form>
  );
}

/** The Customers page's "+" (in the page header) — the New customer form in a modal. */
export function NewCustomerDialog() {
  return (
    <ModalDialog
      title="New customer"
      trigger={(open) => (
        <button type="button" onClick={open} aria-label="New customer" title="New customer" className={headerIconClass}>
          <Icon name="plus" size={18} />
        </button>
      )}
    >
      {() => <AddCustomerForm />}
    </ModalDialog>
  );
}
