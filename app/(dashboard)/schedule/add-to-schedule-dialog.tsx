"use client";

import { useCallback, useRef } from "react";
import { Icon } from "@/components/icons";
import { ScheduleForm } from "./schedule-form";

/** "+ Add to schedule" — the schedule form in a modal that closes once the entry is added. */
export function AddToScheduleDialog({
  projectId,
  projects,
  members,
  redirectPath,
  compact = false,
}: {
  projectId?: string;
  projects?: { id: string; title: string }[];
  members: { id: string; name: string }[];
  redirectPath: string;
  /** A small underlined link (for a card header) instead of the solid button. */
  compact?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = useCallback(() => dialogRef.current?.close(), []);
  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className={
          compact
            ? "cursor-pointer text-[11.5px] font-medium underline"
            : "flex h-[38px] shrink-0 cursor-pointer items-center gap-[6px] rounded-full bg-ink px-4 text-[12.5px] font-semibold text-bg"
        }
      >
        {compact ? null : <span className="text-[16px] leading-none">+</span>}
        {compact ? "+ Add to schedule" : "Add to schedule"}
      </button>
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        className="m-auto w-[min(440px,calc(100vw-24px))] rounded-[20px] border border-line bg-surface p-0 text-ink shadow-[0_20px_60px_rgba(16,18,17,0.25)] backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-[14px] p-[20px]">
          <div className="flex items-center">
            <span className="text-[15px] font-semibold">Add to schedule</span>
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
          <ScheduleForm
            projectId={projectId}
            projects={projects}
            members={members}
            redirectPath={redirectPath}
            onAdded={close}
          />
        </div>
      </dialog>
    </>
  );
}
