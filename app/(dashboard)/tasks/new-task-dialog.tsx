"use client";

import { useCallback, useRef } from "react";
import { Icon } from "@/components/icons";
import type { TaskKind } from "@/lib/task-kinds";
import { AddTaskForm } from "./add-task-form";

/** "+ New task" on /tasks — the add-task form in a modal that closes once the task is added. */
export function NewTaskDialog({
  defaultKind,
  members,
}: {
  defaultKind: TaskKind;
  members: { id: string; name: string }[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = useCallback(() => dialogRef.current?.close(), []);
  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="flex h-[38px] shrink-0 cursor-pointer items-center gap-[6px] rounded-full bg-ink px-4 text-[12.5px] font-semibold text-bg"
      >
        <span className="text-[16px] leading-none">+</span>
        New task
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
          <AddTaskForm redirectPath="/tasks" defaultKind={defaultKind} members={members} layout="stacked" onAdded={close} />
        </div>
      </dialog>
    </>
  );
}
