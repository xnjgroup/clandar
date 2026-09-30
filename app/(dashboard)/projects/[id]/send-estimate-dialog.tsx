"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { defaultEstimateMessage, renderEstimateEmail, type EmailEstimate, type Letterhead } from "@/lib/estimate-email";
import { shrinkImage } from "@/lib/shrink-image";
import { sendEstimate, type FormState } from "./actions";

type Attachable = { id: string; name: string; sizeBytes: number };

const MAX_BYTES = 18 * 1024 * 1024;
const inputClass =
  "w-full rounded-[10px] border border-line bg-surface px-[10px] py-[7px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

function size(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const LETTERHEAD_FIELDS: { key: keyof Letterhead; label: string; placeholder: string; wide?: boolean }[] = [
  { key: "companyName", label: "Company name", placeholder: "Acme Home Improvement LLC", wide: true },
  { key: "address", label: "Address", placeholder: "123 Main St, Springfield, IL", wide: true },
  { key: "phone", label: "Phone", placeholder: "(555) 123-4567" },
  { key: "email", label: "Email", placeholder: "office@acme.com" },
  { key: "website", label: "Website", placeholder: "acme.com" },
  { key: "license", label: "License #", placeholder: "Lic. #HIC-0001234" },
];

/**
 * "Review & send" for a draft estimate: a modal to check and adjust the email
 * before it goes — recipient, sending account, subject, message, the company
 * header (optionally saved as the default) and attachments picked from the
 * project or uploaded on the spot — with a live preview of exactly what the
 * customer will get.
 */
export function SendEstimateDialog({
  resend = false,
  projectId,
  projectTitle,
  estimateId,
  estimate,
  customerName,
  customerEmail,
  connectors,
  letterhead: savedLetterhead,
  files: initialFiles,
  photos,
}: {
  /** Already sent once — the button reads "Resend" and the email goes out again unchanged in content. */
  resend?: boolean;
  projectId: string;
  projectTitle: string;
  estimateId: string;
  estimate: EmailEstimate;
  customerName: string;
  customerEmail: string | null;
  connectors: { id: string; label: string }[];
  letterhead: Letterhead;
  files: Attachable[];
  photos: (Attachable & { url: string })[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState<FormState, FormData>(sendEstimate, {});

  const [to, setTo] = useState(customerEmail ?? "");
  const [subject, setSubject] = useState(`Estimate for ${projectTitle}`);
  const [message, setMessage] = useState(() => defaultEstimateMessage(customerName, projectTitle));
  const [letterhead, setLetterhead] = useState<Letterhead>(savedLetterhead);
  const [saveHeader, setSaveHeader] = useState(true);
  const [files, setFiles] = useState<Attachable[]>(initialFiles);
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const attached = [
    ...files.filter((f) => fileIds.includes(f.id)),
    ...photos.filter((p) => photoIds.includes(p.id)),
  ];
  const attachedBytes = attached.reduce((sum, a) => sum + a.sizeBytes, 0);
  const tooBig = attachedBytes > MAX_BYTES;

  const preview = useMemo(
    () =>
      renderEstimateEmail({
        letterhead,
        message,
        projectTitle,
        estimate,
        attachmentNames: attached.map((a) => a.name),
      }).html,
    // `attached` is derived from these ids and lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [letterhead, message, projectTitle, estimate, fileIds, photoIds, files, photos],
  );

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  /** Uploads a picked file to the project (so it's kept on record) and attaches it. XHR for progress. */
  function upload(file: File) {
    setUploadError(null);
    setUploading({ name: file.name, pct: 0 });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${projectId}/files`);
    xhr.upload.onprogress = (e) => e.total && setUploading({ name: file.name, pct: Math.round((e.loaded / e.total) * 100) });
    xhr.onload = () => {
      setUploading(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        const { id } = JSON.parse(xhr.responseText) as { id: string };
        setFiles((f) => [{ id, name: file.name, sizeBytes: file.size }, ...f]);
        setFileIds((ids) => [...ids, id]);
        router.refresh();
      } else {
        let msg = xhr.status === 413 ? "File is too large." : `Upload failed (${xhr.status}).`;
        try {
          msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg;
        } catch {}
        setUploadError(msg);
      }
    };
    xhr.onerror = () => {
      setUploading(null);
      setUploadError("Network error.");
    };
    const body = new FormData();
    body.append("file", file);
    xhr.send(body);
  }

  // Close once the send succeeds (the page re-renders with the estimate marked sent) — the
  // native <dialog> is DOM state outside React, so this is an effect rather than render logic.
  useEffect(() => {
    if (state.ok) dialogRef.current?.close();
  }, [state]);

  if (connectors.length === 0) {
    return (
      <a href="/connectors" className="text-[11px] text-muted underline">
        Connect a Gmail account to send
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className={`w-fit cursor-pointer rounded-full px-3 py-[6px] text-[11.5px] font-semibold ${
          resend ? "border border-line text-ink" : "bg-ink text-bg"
        }`}
      >
        {resend ? "Resend" : "Review & send"}
      </button>
      {state.ok ? <span className="text-[11px] text-ok-fg">{state.ok}</span> : null}

      <dialog
        ref={dialogRef}
        className="m-auto h-[min(860px,calc(100dvh-32px))] w-[min(1080px,calc(100vw-24px))] max-w-none rounded-[20px] border border-line bg-bg p-0 text-ink shadow-[0_20px_60px_rgba(16,18,17,0.25)] backdrop:bg-black/40"
      >
        <form action={action} className="flex h-full flex-col">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="estimateId" value={estimateId} />
          <input type="hidden" name="saveLetterhead" value={String(saveHeader)} />
          {fileIds.map((id) => (
            <input key={id} type="hidden" name="fileId" value={id} />
          ))}
          {photoIds.map((id) => (
            <input key={id} type="hidden" name="photoId" value={id} />
          ))}

          <div className="flex shrink-0 items-center gap-[10px] border-b border-line-soft bg-surface px-[20px] py-[14px]">
            <span className="text-[15px] font-semibold">{resend ? "Resend estimate email" : "Review estimate email"}</span>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
              className="ml-auto cursor-pointer text-faint hover:text-ink"
            >
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:overflow-hidden">
            {/* Editable parts */}
            <div className="flex flex-col gap-[14px] p-[18px] lg:overflow-y-auto">
              <div className="grid grid-cols-1 gap-[8px]">
                <label className="flex flex-col gap-[4px]">
                  <span className="text-[11px] text-muted">To</span>
                  <input name="to" type="email" required value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
                </label>
                <label className="flex flex-col gap-[4px]">
                  <span className="text-[11px] text-muted">From</span>
                  <select name="connectorId" defaultValue={connectors[0].id} className={inputClass}>
                    {connectors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-[4px]">
                  <span className="text-[11px] text-muted">Subject</span>
                  <input name="subject" required value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
                </label>
                <label className="flex flex-col gap-[4px]">
                  <span className="text-[11px] text-muted">Message</span>
                  <textarea
                    name="message"
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>

              <fieldset className="flex flex-col gap-[8px] rounded-[14px] border border-line p-[12px]">
                <legend className="px-[4px] text-[12px] font-semibold">Company header</legend>
                <div className="grid grid-cols-2 gap-[8px]">
                  {LETTERHEAD_FIELDS.map((f) => (
                    <label key={f.key} className={`flex flex-col gap-[4px] ${f.wide ? "col-span-2" : ""}`}>
                      <span className="text-[11px] text-muted">{f.label}</span>
                      <input
                        name={f.key}
                        value={letterhead[f.key]}
                        placeholder={f.placeholder}
                        onChange={(e) => setLetterhead((l) => ({ ...l, [f.key]: e.target.value }))}
                        className={inputClass}
                      />
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-[7px] text-[12px]">
                  <input type="checkbox" checked={saveHeader} onChange={(e) => setSaveHeader(e.target.checked)} />
                  Save as my default header
                </label>
              </fieldset>

              <fieldset className="flex flex-col gap-[8px] rounded-[14px] border border-line p-[12px]">
                <legend className="px-[4px] text-[12px] font-semibold">Attachments</legend>
                <div className="flex flex-wrap items-center gap-[8px]">
                  <input
                    ref={uploadRef}
                    type="file"
                    hidden
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0];
                      e.currentTarget.value = "";
                      if (file) void shrinkImage(file).then(upload);
                    }}
                  />
                  <button
                    type="button"
                    disabled={Boolean(uploading)}
                    onClick={() => uploadRef.current?.click()}
                    className="cursor-pointer rounded-full border border-line px-3 py-[6px] text-[11.5px] font-medium disabled:opacity-50"
                  >
                    {uploading ? `Uploading ${uploading.pct}%…` : "Upload a file"}
                  </button>
                  <span className={`text-[11px] ${tooBig ? "font-semibold text-bad-fg" : "text-muted"}`}>
                    {attached.length} attached · {size(attachedBytes)} of 18 MB
                  </span>
                </div>
                {uploadError ? <span className="text-[11px] text-bad-fg">{uploadError}</span> : null}

                {photos.length > 0 ? (
                  <div className="flex flex-col gap-[6px]">
                    <span className="text-[11px] text-muted">Project photos</span>
                    <div className="flex flex-wrap gap-[6px]">
                      {photos.map((p) => {
                        const on = photoIds.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => toggle(photoIds, setPhotoIds, p.id)}
                            aria-pressed={on}
                            title={`${p.name} · ${size(p.sizeBytes)}`}
                            className={`relative size-[64px] cursor-pointer overflow-hidden rounded-[10px] border-2 ${on ? "border-ink" : "border-transparent opacity-70 hover:opacity-100"}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated API route, not a static asset */}
                            <img src={p.url} alt="" className="size-full object-cover" />
                            {on ? (
                              <span className="absolute top-[3px] right-[3px] flex size-[16px] items-center justify-center rounded-full bg-ink text-bg">
                                <Icon name="check2" size={10} />
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {files.length > 0 ? (
                  <div className="flex flex-col gap-[4px]">
                    <span className="text-[11px] text-muted">Project files</span>
                    <div className="flex max-h-[180px] flex-col gap-[2px] overflow-y-auto">
                      {files.map((f) => (
                        <label key={f.id} className="flex items-center gap-[8px] rounded-[8px] px-[4px] py-[3px] text-[12px] hover:bg-line-soft">
                          <input type="checkbox" checked={fileIds.includes(f.id)} onChange={() => toggle(fileIds, setFileIds, f.id)} />
                          <span className="min-w-0 flex-1 truncate">{f.name}</span>
                          <span className="shrink-0 font-mono text-[10.5px] text-faint">{size(f.sizeBytes)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </fieldset>
            </div>

            {/* Live preview — the same renderer the server sends with */}
            <div className="flex min-h-[420px] flex-col gap-[6px] border-t border-line-soft bg-surface p-[14px] lg:min-h-0 lg:border-t-0 lg:border-l">
              <span className="text-[11px] font-medium text-muted">Preview — what {to || "the customer"} will see</span>
              <iframe
                title="Email preview"
                srcDoc={preview}
                sandbox=""
                className="min-h-0 w-full flex-1 rounded-[12px] border border-line bg-white"
              />
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-[10px] border-t border-line-soft bg-surface px-[20px] py-[12px]">
            {state.error ? <span className="text-[12px] text-bad-fg">{state.error}</span> : null}
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="ml-auto cursor-pointer rounded-full px-4 py-[8px] text-[12.5px] font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || tooBig || Boolean(uploading)}
              className="cursor-pointer rounded-full bg-ink px-5 py-[8px] text-[12.5px] font-semibold text-bg disabled:opacity-50"
            >
              {pending ? "Sending…" : resend ? "Send again" : "Send estimate"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
