"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";

/**
 * A native <dialog> modal with a title and ✕ that closes on a backdrop click.
 * `trigger` renders what opens it; `children` gets `close` so a form inside can
 * shut it once it's done. Its content stays mounted, so state (like upload
 * progress) survives closing and reopening.
 */
export function ModalDialog({
  title,
  trigger,
  children,
}: {
  title: string;
  trigger: (open: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  // The element is kept in state (a callback ref), not a ref object, so `open`/`close` can be
  // handed to the render props without reading a ref during render.
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const open = useCallback(() => dialog?.showModal(), [dialog]);
  const close = useCallback(() => dialog?.close(), [dialog]);
  return (
    <>
      {trigger(open)}
      <dialog
        ref={setDialog}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="m-auto w-[min(440px,calc(100vw-24px))] rounded-[20px] border border-line bg-surface p-0 text-ink shadow-[0_20px_60px_rgba(16,18,17,0.25)] backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-[14px] p-[20px]">
          <div className="flex items-center">
            <span className="text-[15px] font-semibold">{title}</span>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              title="Close"
              className="ml-auto cursor-pointer text-faint hover:text-ink"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          {children(close)}
        </div>
      </dialog>
    </>
  );
}
