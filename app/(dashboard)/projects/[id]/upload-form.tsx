"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DOC_TYPES } from "@/lib/doc-types";

type Upload = { key: string; name: string; loaded: number; total: number; error?: string; done?: boolean };

const buttonClass =
  "shrink-0 cursor-pointer rounded-full px-[14px] py-[7px] text-[12px] font-semibold disabled:cursor-default disabled:opacity-50";
const stackedButtonClass =
  "h-[42px] flex-1 cursor-pointer rounded-full px-4 text-[12.5px] font-semibold disabled:cursor-default disabled:opacity-50";
const fieldClass =
  "h-[42px] w-full min-w-0 rounded-[12px] border border-line bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Posts one file with XHR so its upload progress can be shown — fetch() has no upload progress events. */
function postFile(
  url: string,
  file: File,
  fields: Record<string, string>,
  onProgress: (loaded: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `Upload failed (${xhr.status}).`;
      if (xhr.status === 413) message = "File is too large.";
      try {
        message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message;
      } catch {}
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Network error."));
    const body = new FormData();
    for (const [name, value] of Object.entries(fields)) body.append(name, value);
    body.append("file", file);
    xhr.send(body);
  });
}

/**
 * A project's photo or file uploader: picks several files (or, with
 * `allowFolders`, a whole folder whose subfolders get recreated), uploads them
 * one at a time, and shows each one's progress. `fields` ride along on every
 * request (e.g. the folder being viewed); `withTags` adds a tag box and
 * `withDocType` a General/Invoice/Receipt picker, both applied to the whole
 * batch. `stacked` lays it out for a modal (labelled fields, full-width
 * buttons); `onDone` runs once a batch has all gone through (e.g. to close it).
 */
export function UploadForm({
  endpoint,
  accept,
  fields = {},
  allowFolders = false,
  withTags = false,
  withDocType = false,
  stacked = false,
  destination,
  onDone,
}: {
  stacked?: boolean;
  /** Where the files will land, shown above the buttons (e.g. the folder being viewed). */
  destination?: string;
  onDone?: () => void;
  endpoint: string;
  accept?: string;
  fields?: Record<string, string>;
  allowFolders?: boolean;
  withTags?: boolean;
  withDocType?: boolean;
}) {
  const router = useRouter();
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [tags, setTags] = useState("");
  const [docType, setDocType] = useState("general");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const busy = uploads.some((u) => !u.done && !u.error);

  function patch(key: string, change: Partial<Upload>) {
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));
  }

  async function start(input: HTMLInputElement | null) {
    const files = Array.from(input?.files ?? []);
    if (input) input.value = "";
    if (files.length === 0) return;
    const batch = files.map((f, i) => ({
      key: `${Date.now()}-${i}`,
      name: f.webkitRelativePath || f.name,
      loaded: 0,
      total: f.size,
    }));
    setUploads(batch);

    let failed = false;
    for (const [i, file] of files.entries()) {
      const { key } = batch[i];
      // "Site visit/Photos/IMG_1.jpg" → "Site visit/Photos"; empty for a plain file pick.
      const relativePath = file.webkitRelativePath.split("/").slice(0, -1).join("/");
      try {
        await postFile(endpoint, file, { ...fields, relativePath, tags, docType }, (loaded) => patch(key, { loaded }));
        patch(key, { loaded: file.size, done: true });
      } catch (err) {
        failed = true;
        patch(key, { error: err instanceof Error ? err.message : "Upload failed." });
      }
    }
    router.refresh();
    // Keep failures on screen; clear the list once everything went through.
    if (!failed) setUploads([]);
    if (withTags) setTags("");
    if (!failed) onDone?.();
  }

  const progress = (
    <>
      {uploads.map((u) => {
        const pct = u.total ? Math.round((u.loaded / u.total) * 100) : 0;
        return (
          <div key={u.key} className="flex flex-col gap-[4px]">
            <div className="flex items-center gap-[8px] text-[11.5px]">
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              <span className={`shrink-0 font-mono ${u.error ? "text-bad-fg" : "text-muted"}`}>
                {u.error ??
                  (u.done
                    ? "Done"
                    : pct === 100
                      ? "Saving…"
                      : `${pct}% · ${fileSize(u.loaded)} / ${fileSize(u.total)}`)}
              </span>
            </div>
            <div className="h-[4px] overflow-hidden rounded-full bg-line-soft">
              <div
                className={`h-full rounded-full transition-[width] ${u.error ? "bg-bad-fg" : u.done ? "bg-ok-fg" : "bg-ink"}`}
                style={{ width: `${u.error ? 100 : pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </>
  );

  const pickers = (
    <>
      <input ref={filesRef} type="file" accept={accept} multiple hidden onChange={(e) => void start(e.currentTarget)} />
      {allowFolders ? (
        <input
          ref={folderRef}
          type="file"
          multiple
          hidden
          // Non-standard but supported by every current browser; React passes it through as-is.
          {...{ webkitdirectory: "" }}
          onChange={(e) => void start(e.currentTarget)}
        />
      ) : null}
    </>
  );

  if (stacked) {
    return (
      <div className="flex flex-col gap-[12px]">
        {pickers}
        {withDocType ? (
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11.5px] font-medium text-muted">What these files are</span>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} disabled={busy} className={fieldClass}>
              {DOC_TYPES.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {withTags ? (
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11.5px] font-medium text-muted">Tags (optional)</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={busy}
              placeholder="e.g. kitchen, before — comma-separated"
              className={fieldClass}
            />
          </label>
        ) : null}
        {destination ? (
          <span className="flex items-center gap-[6px] text-[12px] text-muted">
            Into <span className="font-semibold text-ink">{destination}</span>
          </span>
        ) : null}
        <div className="flex gap-[8px]">
          <button
            type="button"
            disabled={busy}
            onClick={() => filesRef.current?.click()}
            className={`${stackedButtonClass} bg-ink text-bg`}
          >
            {busy ? "Uploading…" : "Choose files"}
          </button>
          {allowFolders ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => folderRef.current?.click()}
              className={`${stackedButtonClass} border border-line`}
            >
              Choose a folder
            </button>
          ) : null}
        </div>
        {progress}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[9px]">
      <div className="flex flex-wrap items-center gap-[9px]">
        {pickers}
        {withDocType ? (
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            disabled={busy}
            aria-label="What these files are"
            className="shrink-0 rounded-[12px] border border-line bg-surface px-2 py-[7px] text-[12px] text-ink"
          >
            {DOC_TYPES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => filesRef.current?.click()}
          className={`${buttonClass} bg-ink text-bg`}
        >
          {busy ? "Uploading…" : "Upload files"}
        </button>
        {allowFolders ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => folderRef.current?.click()}
            className={`${buttonClass} border border-line`}
          >
            Upload folder
          </button>
        ) : null}
        {withTags ? (
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            disabled={busy}
            placeholder="Tags for these uploads, comma-separated"
            className="min-w-[180px] flex-1 rounded-[12px] border border-line bg-surface px-3 py-[7px] text-[12px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]"
          />
        ) : null}
      </div>

      {progress}
    </div>
  );
}
