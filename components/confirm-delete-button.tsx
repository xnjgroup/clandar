"use client";

import { useRef, useTransition } from "react";
import { Icon } from "@/components/icons";

/**
 * A delete button that asks first: opens a small modal naming what goes, and
 * only calls `action` (a server action taking FormData, built from `fields`)
 * after "Delete" is clicked. `compact` renders just the trash icon, for rows.
 */
export function ConfirmDeleteButton({
  action,
  fields,
  title,
  message,
  label = "Delete",
  compact = false,
}: {
  action: (form: FormData) => Promise<void> | void;
  fields: Record<string, string>;
  title: string;
  message: string;
  label?: string;
  compact?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    startTransition(async () => {
      await action(form);
      dialogRef.current?.close();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Rows are often links — don't navigate when the trash is clicked.
          e.preventDefault();
          e.stopPropagation();
          dialogRef.current?.showModal();
        }}
        aria-label={`${label}: ${title}`}
        title={label}
        className={
          compact
            ? "flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-full text-faint hover:bg-bad-bg hover:text-bad-fg"
            : "flex cursor-pointer items-center gap-[6px] rounded-full border border-line px-[12px] py-[7px] text-[12px] font-medium text-bad-fg hover:bg-bad-bg"
        }
      >
        <Icon name="trash" size={compact ? 15 : 14} />
        {compact ? null : label}
      </button>
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current && !pending) dialogRef.current.close();
        }}
        className="m-auto w-[min(400px,calc(100vw-32px))] rounded-[20px] border border-line bg-surface p-0 text-ink shadow-[0_20px_60px_rgba(16,18,17,0.25)] backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-[14px] p-[20px]">
          <div className="flex items-start gap-[12px]">
            <span className="flex size-[36px] shrink-0 items-center justify-center rounded-full bg-bad-bg text-bad-fg">
              <Icon name="trash" size={18} />
            </span>
            <div className="flex min-w-0 flex-col gap-[3px]">
              <span className="text-[15px] font-semibold">{title}</span>
              <span className="text-[12.5px] leading-[1.5] text-muted">{message}</span>
            </div>
          </div>
          <div className="flex items-center justify-end gap-[10px]">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              disabled={pending}
              className="cursor-pointer rounded-full px-4 py-[8px] text-[12.5px] font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              autoFocus
              className="cursor-pointer rounded-full bg-bad-fg px-4 py-[8px] text-[12.5px] font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Deleting…" : label}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
