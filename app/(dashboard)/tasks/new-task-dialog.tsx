"use client";

import { useCallback, useRef } from "react";
import { headerIconClass } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { TaskKind } from "@/lib/task-kinds";
import { AddTaskForm } from "./add-task-form";

/**
 * "+ New task" — the add-task form in a modal that closes once the task is
 * added. On /tasks, and on a project page (`projectId`, as a `compact` header link).
 */
export function NewTaskDialog({
  defaultKind = "todo",
  members,
  projectId,
  redirectPath = "/tasks",
  compact = false,
  iconOnly = false,
}: {
  /** A square "+" icon button (for the page header). */
  iconOnly?: boolean;
  defaultKind?: TaskKind;
  members: { id: string; name: string }[];
  projectId?: string;
  redirectPath?: string;
  /** A small underlined link (for a card header) instead of the solid button. */
  compact?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = useCallback(() => dialogRef.current?.close(), []);
  return (
    <>
      {iconOnly ? (
        <button
          type="button"
          onClick={() => dialogRef.current?.showModal()}
          aria-label="New task"
          title="New task"
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
          {compact ? "+ New task" : "New task"}
        </button>
      )}
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        className="m-auto w-[min(440px,calc(100vw-24px))] rounded-[20px] border border-line bg-surface p-0 text-ink shadow-[0_20px_60px_rgba(16,18,17,0.25)] backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-[14px] p-[20px]">
          <div className="flex items-center">
            <span className="text-[15px] font-semibold">New task</span>
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
          <AddTaskForm
            projectId={projectId}
            redirectPath={redirectPath}
            defaultKind={defaultKind}
            members={members}
            onAdded={close}
          />
        </div>
      </dialog>
    </>
  );
}
