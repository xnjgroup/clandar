"use client";

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { tagFile } from "./actions";

const clean = (value: string) => value.trim().toLowerCase().slice(0, 40);

/**
 * A file's "Tags" button and the modal it opens: current tags as removable
 * chips, a box that adds one on Enter or comma, and the project's other tags
 * as one-click suggestions. A native <dialog> so it sits above the page
 * (nothing can clip it) and gets Esc/backdrop handling for free.
 */
export function TagsDialog({
  projectId,
  fileId,
  fileName,
  tags,
  suggestions,
}: {
  projectId: string;
  fileId: string;
  fileName: string;
  tags: string[];
  suggestions: string[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string[]>(tags);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();

  function open() {
    setDraft(tags);
    setInput("");
    dialogRef.current?.showModal();
    inputRef.current?.focus();
  }

  function add(value: string) {
    const tag = clean(value);
    if (tag && !draft.includes(tag)) setDraft((d) => [...d, tag].slice(0, 20));
    setInput("");
  }

  function save() {
    // Whatever's still typed in the box counts too.
    const final = input.trim() && !draft.includes(clean(input)) ? [...draft, clean(input)] : draft;
    const form = new FormData();
    form.set("projectId", projectId);
    form.set("fileId", fileId);
    form.set("tags", final.join(","));
    startTransition(async () => {
      await tagFile(form);
      dialogRef.current?.close();
    });
  }

  const unused = suggestions.filter((s) => !draft.includes(s) && (!input || s.includes(clean(input))));

  return (
    <>
      <button type="button" onClick={open} className="shrink-0 cursor-pointer text-[11.5px] text-muted underline">
        Tags
      </button>
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          // A click on the backdrop lands on the <dialog> itself.
          if (e.target === dialogRef.current) dialogRef.current.close();
        }}
        className="m-auto w-[min(440px,calc(100vw-32px))] rounded-[20px] border border-line bg-surface p-0 text-ink shadow-[0_20px_60px_rgba(16,18,17,0.25)] backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-[14px] p-[20px]">
          <div className="flex items-start gap-[10px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[15px] font-semibold">Tags</span>
              <span className="truncate text-[12px] text-muted">{fileName}</span>
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
              className="cursor-pointer text-faint hover:text-ink"
            >
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="flex min-h-[44px] flex-wrap items-center gap-[6px] rounded-[12px] border border-line px-[8px] py-[6px] focus-within:border-[#9aa78a]">
            {draft.map((t) => (
              <span
                key={t}
                className="flex items-center gap-[4px] rounded-full bg-line-soft py-[3px] pr-[5px] pl-[9px] text-[12px] font-medium"
              >
                #{t}
                <button
                  type="button"
                  onClick={() => setDraft((d) => d.filter((x) => x !== t))}
                  aria-label={`Remove ${t}`}
                  className="flex cursor-pointer text-faint hover:text-bad-fg"
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
            <input
              value={input}
              onChange={(e) => {
                const value = e.target.value;
                // Typing or pasting a comma commits everything before it.
                if (value.includes(",")) {
                  const parts = value.split(",");
                  parts.slice(0, -1).forEach(add);
                  setInput(parts[parts.length - 1]);
                } else setInput(value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (input.trim()) add(input);
                  else save();
                } else if (e.key === "Backspace" && !input && draft.length > 0) {
                  setDraft((d) => d.slice(0, -1));
                }
              }}
              ref={inputRef}
              placeholder={draft.length ? "Add another…" : "Type a tag, press Enter"}
              className="min-w-[120px] flex-1 bg-transparent py-[3px] text-[13px] outline-none placeholder:text-faint"
            />
          </div>

          {unused.length > 0 ? (
            <div className="flex flex-col gap-[6px]">
              <span className="text-[11px] text-muted">Used in this project</span>
              <div className="flex flex-wrap gap-[6px]">
                {unused.slice(0, 16).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => add(s)}
                    className="cursor-pointer rounded-full border border-line px-[9px] py-[3px] text-[12px] text-body hover:bg-line-soft"
                  >
                    + #{s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-[10px]">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="cursor-pointer rounded-full px-4 py-[8px] text-[12.5px] font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="cursor-pointer rounded-full bg-ink px-4 py-[8px] text-[12.5px] font-semibold text-bg disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
