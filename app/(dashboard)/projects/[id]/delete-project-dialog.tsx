"use client";

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { removeProject } from "../actions";

/**
 * "Delete project" with a confirmation modal that spells out what goes with it
 * (the delete cascades to everything on the project) and asks for the project's
 * name to be typed, since nothing here can be undone.
 */
export function DeleteProjectDialog({
  projectId,
  projectTitle,
  counts,
}: {
  projectId: string;
  projectTitle: string;
  counts: { label: string; count: number }[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const matches = typed.trim().toLowerCase() === projectTitle.trim().toLowerCase();
  const nonEmpty = counts.filter((c) => c.count > 0);

  function confirm() {
    const form = new FormData();
    form.set("id", projectId);
    // removeProject redirects to /projects when it's done.
    startTransition(() => removeProject(form));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setTyped("");
          dialogRef.current?.showModal();
        }}
        className="flex cursor-pointer items-center gap-[6px] rounded-full border border-line px-[12px] py-[7px] text-[12px] font-medium text-bad-fg hover:bg-bad-bg"
      >
        <Icon name="trash" size={14} />
        Delete project
      </button>
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current && !pending) dialogRef.current.close();
        }}
        className="m-auto w-[min(440px,calc(100vw-32px))] rounded-[20px] border border-line bg-surface p-0 text-ink shadow-[0_20px_60px_rgba(16,18,17,0.25)] backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-[14px] p-[20px]">
          <div className="flex items-start gap-[12px]">
            <span className="flex size-[36px] shrink-0 items-center justify-center rounded-full bg-bad-bg text-bad-fg">
              <Icon name="trash" size={18} />
            </span>
            <div className="flex min-w-0 flex-col gap-[3px]">
              <span className="text-[15px] font-semibold">Delete this project?</span>
              <span className="text-[12.5px] leading-[1.5] text-muted">
                <span className="font-semibold text-ink">{projectTitle}</span> will be permanently deleted. This can&rsquo;t be undone.
              </span>
            </div>
          </div>

          {nonEmpty.length > 0 ? (
            <div className="flex flex-col gap-[6px] rounded-[12px] bg-bad-bg px-[12px] py-[10px]">
              <span className="text-[11.5px] font-semibold text-bad-fg">Also deleted with it:</span>
              <ul className="m-0 flex flex-wrap gap-x-[14px] gap-y-[2px] p-0 text-[12px] text-ink">
                {nonEmpty.map((c) => (
                  <li key={c.label} className="list-none">
                    {c.count} {c.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <label className="flex flex-col gap-[5px]">
            <span className="text-[11.5px] text-muted">
              Type <span className="font-semibold text-ink">{projectTitle}</span> to confirm
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                // This dialog sits inside the project's Save form — Enter must never submit that.
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (matches && !pending) confirm();
              }}
              autoComplete="off"
              className="rounded-[12px] border border-line bg-surface px-3 py-[9px] text-[13px] text-ink outline-none focus:border-bad-fg"
            />
          </label>

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
              disabled={!matches || pending}
              className="cursor-pointer rounded-full bg-bad-fg px-4 py-[8px] text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? "Deleting…" : "Delete project"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
