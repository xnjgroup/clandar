"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { saveLink } from "./actions";
import { Icon } from "@/components/icons";
import { ModalDialog } from "@/components/modal-dialog";
import { headerIconClass } from "@/components/ui";

type Upload = { name: string; progress: number; error?: string; done?: boolean };

/** Upload documents to the Library — each file its own request, with progress; they're read for search after. */
export function LibraryUploadDialog() {
  const router = useRouter();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [tags, setTags] = useState("");

  function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    const start = uploads.length;
    setUploads((u) => [...u, ...list.map((f) => ({ name: f.name, progress: 0 }))]);
    let remaining = list.length;
    list.forEach((file, i) => {
      const index = start + i;
      const update = (patch: Partial<Upload>) => setUploads((u) => u.map((x, j) => (j === index ? { ...x, ...patch } : x)));
      const body = new FormData();
      body.set("file", file);
      body.set("tags", tags);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/library/files");
      xhr.upload.onprogress = (e) => e.lengthComputable && update({ progress: e.loaded / e.total });
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) update({ progress: 1, done: true });
        else update({ error: (() => { try { return JSON.parse(xhr.responseText).error; } catch { return "Upload failed."; } })() });
        if (--remaining === 0) router.refresh();
      };
      xhr.onerror = () => {
        update({ error: "Upload failed." });
        if (--remaining === 0) router.refresh();
      };
      xhr.send(body);
    });
  }

  return (
    <ModalDialog
      title="Add to Library"
      trigger={(open) => (
        <button type="button" onClick={open} aria-label="Add to Library" title="Add to Library" className={headerIconClass}>
          <Icon name="plus" size={18} />
        </button>
      )}
    >
      {() => (
        <div className="flex flex-col gap-[12px]">
          <SaveLinkForm />
          <div className="flex items-center gap-[10px] text-[11px] text-faint">
            <span className="h-px flex-1 bg-line" />
            or upload files
            <span className="h-px flex-1 bg-line" />
          </div>
          <p className="m-0 text-[12.5px] text-muted">
            PDFs, Word, Excel, PowerPoint, text and emails are read so the assistant can search them — in English or Chinese.
            A project&apos;s files are already here; add anything else (insurance, licenses, manuals, warranties).
          </p>
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11.5px] font-medium text-muted">Tags (optional, comma-separated)</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="warranty, insurance"
              className="h-[40px] rounded-[12px] border border-line bg-surface px-3 text-[12.5px] outline-none focus:border-[#9aa78a]"
            />
          </label>
          <label className="flex cursor-pointer flex-col items-center gap-[6px] rounded-[14px] border border-dashed border-line px-4 py-[22px] text-[12.5px] text-muted hover:bg-bg">
            <Icon name="upload" size={20} />
            <span className="font-semibold text-ink">Choose files</span>
            <span>Up to 50 MB each</span>
            <input type="file" multiple className="sr-only" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          </label>
          {uploads.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-[6px] p-0 text-[12px]">
              {uploads.map((u, i) => (
                <li key={i} className="flex items-center gap-[8px]">
                  <span className="min-w-0 flex-1 truncate">{u.name}</span>
                  <span className={u.error ? "text-bad-fg" : u.done ? "text-ok-fg" : "text-muted"}>
                    {u.error ?? (u.done ? "Added — reading it now" : `${Math.round(u.progress * 100)}%`)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </ModalDialog>
  );
}

/** Paste a link: the article is read, summarized and saved, then opened. */
function SaveLinkForm() {
  const [state, action, pending] = useActionState(saveLink, {});
  return (
    <form action={action} className="flex flex-col gap-[6px]">
      <span className="text-[11.5px] font-medium text-muted">Save an article</span>
      <div className="flex gap-[8px]">
        <input
          name="url"
          type="url"
          required
          placeholder="https://…  (news, blogs, WeChat articles)"
          className="h-[40px] min-w-0 flex-1 rounded-[12px] border border-line bg-surface px-3 text-[12.5px] outline-none focus:border-[#9aa78a]"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-[40px] shrink-0 cursor-pointer rounded-[12px] bg-ink px-[14px] text-[12.5px] font-semibold text-bg disabled:opacity-60"
        >
          {pending ? "Reading…" : "Save"}
        </button>
      </div>
      {pending ? <span className="text-[11.5px] text-muted">Reading and summarizing — this takes up to half a minute.</span> : null}
      {state.error ? <span className="text-[11.5px] text-bad-fg">{state.error}</span> : null}
    </form>
  );
}
