"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { ModalDialog } from "@/components/modal-dialog";
import { headerIconClass } from "@/components/ui";
import { addProject, type FormState } from "./actions";

const inputClass =
  "w-full rounded-[12px] border border-line bg-surface px-3 py-[10px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

export function NewProjectForm({
  customers,
  projectTypes,
  defaultCustomerId,
  inModal = false,
}: {
  customers: { id: string; name: string }[];
  projectTypes: { id: string; name: string }[];
  defaultCustomerId?: string;
  /** In the Projects page's "New project" modal: one column, no Cancel link (the modal has ✕). */
  inModal?: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(addProject, {});

  if (customers.length === 0) {
    return (
      <p className="m-0 rounded-[12px] bg-warn-bg px-3 py-[10px] text-[12.5px] leading-[1.6] text-warn-fg">
        Add a customer first —{" "}
        <Link href="/customers" className="underline">
          go to Customers
        </Link>
        .
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-[13px]">
      <div className={`grid grid-cols-1 gap-[10px] ${inModal ? "" : "lg:grid-cols-2"}`}>
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Customer</span>
          <select name="customerId" required defaultValue={defaultCustomerId ?? ""} className={inputClass}>
            <option value="" disabled>
              Select a customer…
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Project type</span>
          {projectTypes.length === 0 ? (
            <p className="m-0 rounded-[12px] border border-line bg-surface px-3 py-[10px] text-[11.5px] leading-[1.5] text-muted">
              No project types yet —{" "}
              <Link href="/projects/types" className="underline">
                add some
              </Link>
              .
            </p>
          ) : (
            <select name="projectTypeId" defaultValue={projectTypes[0].id} className={inputClass}>
              {projectTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="flex flex-col gap-[5px] lg:col-span-2">
          <span className="text-[11px] text-muted">Project title</span>
          <input name="title" required placeholder="Repaint living room & hallway" className={inputClass} />
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Project site address</span>
          <input name="address" placeholder="Defaults to the customer's address if left blank" className={inputClass} />
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className="text-[11px] text-muted">Due date</span>
          <input name="dueDate" type="date" className={inputClass} />
        </label>
        <label className="flex flex-col gap-[5px] lg:col-span-2">
          <span className="text-[11px] text-muted">Notes</span>
          <textarea name="notes" rows={3} placeholder="Scope, access notes, anything the crew should know" className={inputClass} />
        </label>
      </div>

      <div className="flex items-center gap-[9px]">
        <button
          type="submit"
          disabled={pending}
          className={`rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg enabled:cursor-pointer disabled:opacity-50 ${
            inModal ? "h-[42px] w-full" : ""
          }`}
        >
          {pending ? "Creating…" : "Create project"}
        </button>
        {inModal ? null : (
          <Link href="/projects" className="text-[11.5px] font-medium underline">
            Cancel
          </Link>
        )}
      </div>

      {state.error ? (
        <p className="m-0 rounded-[12px] bg-bad-bg px-3 py-2 text-[12px] leading-[1.5] text-bad-fg">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** The Projects page's "+" (in the page header) — the New project form in a modal; creating opens the project. */
export function NewProjectDialog({
  customers,
  projectTypes,
}: {
  customers: { id: string; name: string }[];
  projectTypes: { id: string; name: string }[];
}) {
  return (
    <ModalDialog
      title="New project"
      trigger={(open) => (
        <button type="button" onClick={open} aria-label="New project" title="New project" className={headerIconClass}>
          <Icon name="plus" size={18} />
        </button>
      )}
    >
      {() => <NewProjectForm customers={customers} projectTypes={projectTypes} inModal />}
    </ModalDialog>
  );
}
