"use client";

import { useRef } from "react";
import { JOBS_CHANGED_EVENT } from "@/components/use-notifications";
import { startTrashLabel } from "./actions";

/**
 * "Trash all X" plus a confirmation step — a native `<dialog>` rather than
 * `window.confirm()`, so it can actually explain what's about to happen and
 * how many messages that is. Submitting just enqueues the job (see
 * `startTrashLabel`) and closes the dialog; the page's own progress panel
 * (rendered separately, from live job status) shows how it's going.
 */
export function TrashLabelButton({
  connectorId,
  label,
  labelName,
  count,
  disabled,
  disabledReason,
}: {
  connectorId: string;
  label: string;
  labelName: string;
  count: number;
  disabled: boolean;
  disabledReason?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  if (count === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        className="ml-auto shrink-0 rounded-full bg-bad-fg px-[13px] py-[7px] text-[11.5px] font-semibold text-bg enabled:cursor-pointer disabled:opacity-40"
      >
        Trash all {labelName.toLowerCase()}
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-[min(420px,90vw)] rounded-[18px] border border-line bg-surface p-0 text-ink backdrop:bg-black/30"
      >
        <form
          action={startTrashLabel}
          onSubmit={() => {
            dialogRef.current?.close();
            // Its progress (and a note when it's done) shows in the assistant's Updates.
            window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
          }}
          className="flex flex-col gap-[13px] p-[20px]"
        >
          <input type="hidden" name="connectorId" value={connectorId} />
          <input type="hidden" name="label" value={label} />
          <h2 className="m-0 text-[15px] font-bold tracking-[-0.02em]">
            Move {count.toLocaleString("en-US")} {labelName.toLowerCase()} message
            {count === 1 ? "" : "s"} to Trash?
          </h2>
          <p className="m-0 text-[12.5px] leading-[1.55] text-muted">
            This runs in the background — you can keep using the app while it works. Trash is
            reversible for 30 days in Gmail; nothing here is a permanent delete.
          </p>
          <div className="flex justify-end gap-[8px]">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="cursor-pointer rounded-full border border-line px-[14px] py-[8px] text-[12px] font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cursor-pointer rounded-full bg-bad-fg px-[14px] py-[8px] text-[12px] font-semibold text-bg"
            >
              Move to Trash
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
