"use client";

import { useActionState, useEffect, useState } from "react";
import { deleteCompany, type FormState } from "./actions";

/** Owner-only, irreversible: deletes the org and everything in it (customers, projects, invoices, files — all of it). */
export function DeleteCompanyForm({ orgName }: { orgName: string }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [state, action, pending] = useActionState<FormState, FormData>(deleteCompany, {});

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, pending]);

  return (
    <>
      <div className="flex flex-col gap-[6px]">
        <p className="m-0 text-[11.5px] leading-[1.55] text-muted">
          Permanently deletes {orgName} — every customer, project, invoice, file, and teammate. This cannot be
          undone.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-fit cursor-pointer rounded-full border border-bad-fg px-4 py-[8px] text-[12px] font-semibold text-bad-fg"
        >
          Delete my company
        </button>
      </div>

      {open ? (
        <div role="dialog" aria-modal="true" aria-label="Delete company" className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Cancel"
            onClick={() => !pending && setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/40"
          />
          <div className="absolute top-1/2 left-1/2 flex w-[92vw] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col gap-[14px] rounded-[18px] border border-line bg-surface p-[22px] shadow-[0_20px_60px_rgba(16,18,17,0.3)]">
            <h2 className="m-0 text-[16px] font-bold">Delete {orgName}?</h2>
            <p className="m-0 text-[12.5px] leading-[1.6] text-body-soft">
              This permanently deletes every customer, project, invoice, expense, file, teammate, and connector for
              this company. There is no undo. To confirm, type the company name below.
            </p>
            <form action={action} className="flex flex-col gap-[10px]">
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                name="confirmName"
                autoFocus
                placeholder={orgName}
                className="w-full rounded-[12px] border border-line bg-bg px-3 py-[10px] text-[13px] text-ink outline-none placeholder:text-faint focus:border-bad-fg"
              />
              <div className="flex items-center justify-end gap-[10px]">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                  className="cursor-pointer rounded-full border border-line px-4 py-[9px] text-[12.5px] font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending || confirmText !== orgName}
                  className="cursor-pointer rounded-full bg-bad-fg px-4 py-[9px] text-[12.5px] font-semibold text-bg enabled:cursor-pointer disabled:opacity-40"
                >
                  {pending ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
              {state.error ? (
                <p className="m-0 rounded-[10px] bg-bad-bg px-3 py-2 text-[12px] leading-[1.5] text-bad-fg">
                  {state.error}
                </p>
              ) : null}
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
