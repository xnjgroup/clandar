"use client";

import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { headerIconClass } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { ScheduleEntry } from "@/lib/schedule";
import { ScheduleForm } from "./schedule-form";

type Members = { id: string; name: string }[];
type Projects = { id: string; title: string }[];

/** The modal frame shared by adding and editing: title, ✕, closes on a backdrop click. */
function ScheduleModal({
  dialogRef,
  title,
  onClose,
  children,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="m-auto w-[min(440px,calc(100vw-24px))] rounded-[20px] border border-line bg-surface p-0 text-ink shadow-[0_20px_60px_rgba(16,18,17,0.25)] backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-[14px] p-[20px]">
        <div className="flex items-center">
          <span className="text-[15px] font-semibold">{title}</span>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close"
            title="Close"
            className="ml-auto cursor-pointer text-faint hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** "+ Add to schedule" — the schedule form in a modal that closes once the entry is added. */
export function AddToScheduleDialog({
  projectId,
  projects,
  members,
  redirectPath,
  compact = false,
  iconOnly = false,
}: {
  projectId?: string;
  projects?: Projects;
  members: Members;
  redirectPath: string;
  /** A small underlined link (for a card header) instead of the solid button. */
  compact?: boolean;
  /** A square "+" icon button (for the page header). */
  iconOnly?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = useCallback(() => dialogRef.current?.close(), []);
  return (
    <>
      {iconOnly ? (
        <button
          type="button"
          onClick={() => dialogRef.current?.showModal()}
          aria-label="Add to schedule"
          title="Add to schedule"
          className={headerIconClass}
        >
          <Icon name="plus" size={18} />
        </button>
      ) : (
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
      )}
      <ScheduleModal dialogRef={dialogRef} title="Add to schedule" onClose={() => {}}>
        <ScheduleForm
          projectId={projectId}
          projects={projects}
          members={members}
          redirectPath={redirectPath}
          onAdded={close}
        />
      </ScheduleModal>
    </>
  );
}

/**
 * Edit a schedule entry — opened by setting `entry` (from a list's edit button),
 * and `onClose` clears it again. One dialog serves a whole list.
 */
export function EditScheduleDialog({
  entry,
  onClose,
  projectId,
  projects,
  members,
  redirectPath,
}: {
  entry: ScheduleEntry | null;
  onClose: () => void;
  projectId?: string;
  projects?: Projects;
  members: Members;
  redirectPath: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = useCallback(() => dialogRef.current?.close(), []);
  useEffect(() => {
    if (entry && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [entry]);
  return (
    <ScheduleModal dialogRef={dialogRef} title="Edit schedule entry" onClose={onClose}>
      {entry ? (
        <ScheduleForm
          key={entry.id}
          entry={entry}
          projectId={projectId}
          projects={projects}
          members={members}
          redirectPath={redirectPath}
          onAdded={close}
        />
      ) : null}
    </ScheduleModal>
  );
}
