import Link from "next/link";
import { Icon } from "@/components/icons";
import { EmptyRow, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { hrefWith, money, type SearchParams } from "@/lib/data";
import { DOC_TYPES } from "@/lib/doc-types";
import {
  listProjectFiles,
  listProjectFilesByTag,
  listProjectFileTags,
  listProjectFolders,
  type ProjectFolder,
} from "@/lib/project-photos";
import { changeFileDocType, moveFile, removeFile, removeFolder, renameFolder, reparseFile } from "./actions";
import { AutoSubmitSelect } from "./auto-submit-select";
import { NewFolderForm } from "./new-folder-form";
import { RefreshWhile } from "./refresh-while";
import { TagsDialog } from "./tags-dialog";
import { UploadForm } from "./upload-form";

const smallInput =
  "min-w-0 flex-1 rounded-[10px] border border-line bg-surface px-2 py-[5px] text-[12px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Root-first chain of folders ending at `id`. */
function ancestry(byId: Map<string, ProjectFolder>, id: string | null): ProjectFolder[] {
  const chain: ProjectFolder[] = [];
  for (let f = id ? byId.get(id) : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) chain.unshift(f);
  return chain;
}

/**
 * A project's Files card: browse folders (`?folder=`), or every file with one
 * tag across all folders (`?tag=`). The page's other search params are kept
 * on every link so the rest of the page doesn't reset.
 */
export async function FilesSection({ projectId, params }: { projectId: string; params: SearchParams }) {
  const folderParam = typeof params.folder === "string" ? params.folder : "";
  const tag = typeof params.tag === "string" ? params.tag : "";

  const [folders, tags] = await Promise.all([listProjectFolders(projectId), listProjectFileTags(projectId)]);
  const byId = new Map(folders.map((f) => [f.id, f]));
  // An unknown/stale ?folder= falls back to the top level.
  const folderId = folderParam && byId.has(folderParam) ? folderParam : null;
  const files = tag ? await listProjectFilesByTag(projectId, tag) : await listProjectFiles(projectId, folderId);
  const subfolders = tag ? [] : folders.filter((f) => f.parentId === folderId);
  const trail = ancestry(byId, folderId);
  const pathOf = (id: string | null) => ancestry(byId, id).map((f) => f.name).join(" / ");
  const folderOptions = folders.map((f) => ({ id: f.id, path: pathOf(f.id) })).sort((a, b) => a.path.localeCompare(b.path));

  const base = `/projects/${projectId}`;
  const link = (updates: Record<string, string | null>) => `${hrefWith(base, params, updates)}#files`;

  return (
    <TableCard>
      <div id="files" className="scroll-mt-4" />
      <RefreshWhile active={files.some((f) => f.parseStatus === "pending")} />
      <TableHeader>
        <TableTitle>Files</TableTitle>
        <nav className="flex min-w-0 flex-wrap items-center gap-[4px] text-[12px]">
          <Link href={link({ folder: null, tag: null })} scroll={false} className="font-medium underline">
            All folders
          </Link>
          {trail.map((f) => (
            <span key={f.id} className="flex items-center gap-[4px]">
              <span className="text-faint">/</span>
              <Link href={link({ folder: f.id, tag: null })} scroll={false} className="font-medium underline">
                {f.name}
              </Link>
            </span>
          ))}
        </nav>
      </TableHeader>

      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-[6px] px-[18px] py-[10px]">
          <span className="text-[11px] text-muted">Tags</span>
          {tags.map((t) => (
            <Link
              key={t}
              href={link({ tag: tag === t ? null : t, folder: null })}
              scroll={false}
              className={`rounded-full px-[10px] py-[3px] text-[11.5px] font-medium ${
                tag === t ? "bg-ink text-bg" : "border border-line bg-surface text-body"
              }`}
            >
              #{t}
            </Link>
          ))}
        </div>
      ) : null}

      {tag ? (
        <div className="border-t border-line-soft px-[18px] py-[10px] text-[12px] text-muted">
          Every file tagged <span className="font-semibold text-ink">#{tag}</span>, across all folders.{" "}
          <Link href={link({ tag: null })} scroll={false} className="underline">
            Clear
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-[10px] border-t border-line-soft px-[18px] py-[13px]">
          <UploadForm
            endpoint={`/api/projects/${projectId}/files`}
            fields={{ folderId: folderId ?? "" }}
            allowFolders
            withTags
            withDocType
          />
          <NewFolderForm projectId={projectId} parentId={folderId ?? ""} />
        </div>
      )}

      {subfolders.map((f) => (
        <div key={f.id} className="flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-[4px] border-t border-line-soft px-[18px] py-[9px]">
          <Icon name="layers" size={16} className="shrink-0 text-body-soft" />
          <Link
            href={link({ folder: f.id })}
            scroll={false}
            className="min-w-0 flex-1 truncate text-[12.5px] font-semibold hover:underline"
          >
            {f.name}
          </Link>
          <span className="shrink-0 font-mono text-[11px] text-faint">
            {f.itemCount} item{f.itemCount === 1 ? "" : "s"}
          </span>
          <details className="shrink-0 open:order-last open:basis-full">
            <summary className="cursor-pointer list-none text-[11.5px] text-muted underline">Rename</summary>
            <form
              action={renameFolder}
              className="mt-[8px] flex max-w-[420px] items-center gap-[6px]"
            >
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="folderId" value={f.id} />
              <input name="name" defaultValue={f.name} required maxLength={120} className={smallInput} />
              <button type="submit" className="cursor-pointer text-[12px] font-semibold">
                Save
              </button>
            </form>
          </details>
          {f.itemCount === 0 ? (
            <form action={removeFolder}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="folderId" value={f.id} />
              <button type="submit" aria-label="Delete empty folder" className="cursor-pointer text-faint hover:text-bad-fg">
                <Icon name="close" size={14} />
              </button>
            </form>
          ) : (
            <span className="w-[14px] shrink-0" />
          )}
        </div>
      ))}

      {files.length === 0 && subfolders.length === 0 ? (
        <EmptyRow>
          {tag ? "No files with this tag." : folderId ? "This folder is empty." : "No files yet — permits, contracts, receipts."}
        </EmptyRow>
      ) : null}

      {files.map((file) => (
        <div key={file.id} className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-[6px] border-t border-line-soft px-[18px] py-[10px]">
          <Icon name="doc" size={16} className="shrink-0 text-body-soft" />
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <a
              href={`/api/projects/${projectId}/files/${file.id}`}
              target="_blank"
              rel="noreferrer"
              className="truncate text-[12.5px] font-medium underline"
            >
              {file.fileName}
            </a>
            {file.invoice ? (
              <span className="truncate text-[11px] text-muted md:hidden">
                {file.invoice.vendorName}
                {file.invoice.accountNumber ? ` · Acct ${file.invoice.accountNumber}` : ""}
              </span>
            ) : null}
            {file.docType !== "general" && !file.invoice ? (
              <div className="flex flex-wrap items-center gap-[6px] text-[11px]">
                {file.parseStatus === "pending" ? (
                  <span className="text-muted">Reading the {file.docType} with AI…</span>
                ) : file.parseStatus === "failed" ? (
                  <>
                    <span className="text-bad-fg">Couldn&rsquo;t read it: {file.parseError}</span>
                    <form action={reparseFile}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="fileId" value={file.id} />
                      <button type="submit" className="cursor-pointer font-medium underline">
                        Retry
                      </button>
                    </form>
                  </>
                ) : null}
              </div>
            ) : null}
            {tag || file.tags.length > 0 ? (
              <div className="flex flex-wrap items-center gap-[4px]">
                {tag ? <span className="text-[11px] text-muted">{pathOf(file.folderId) || "Top level"} ·</span> : null}
                {file.tags.map((t) => (
                  <Link
                    key={t}
                    href={link({ tag: t, folder: null })}
                    scroll={false}
                    className="rounded-full bg-line-soft px-[7px] py-[1px] text-[10.5px] font-medium text-body"
                  >
                    #{t}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          {/* Invoice columns — filled once an invoice/receipt has been parsed, kept as empty slots otherwise so rows
              line up. Vendor/account need room, so below md they move under the file name instead. */}
          <span className="hidden w-[150px] shrink-0 truncate text-[12px] md:block" title={file.invoice?.vendorName}>
            {file.invoice?.vendorName}
          </span>
          <span
            className="hidden w-[110px] shrink-0 truncate font-mono text-[11.5px] text-muted md:block"
            title={file.invoice?.accountNumber ?? undefined}
          >
            {file.invoice ? (file.invoice.accountNumber ?? "—") : null}
          </span>
          <span className="w-[96px] shrink-0 text-right">
            {file.invoice ? (
              <Link
                href={`/invoices/${file.invoice.vendorSlug}?id=${file.invoice.id}`}
                title={`Open the ${file.docType === "receipt" ? "receipt" : "invoice"} record`}
                className="font-mono text-[12.5px] font-semibold text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
              >
                {money(file.invoice.amount)}
              </Link>
            ) : null}
          </span>
          <span className="w-[60px] shrink-0 text-right font-mono text-[11px] text-faint">{fileSize(file.sizeBytes)}</span>
          <form action={changeFileDocType} className="shrink-0">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="fileId" value={file.id} />
            <AutoSubmitSelect
              name="docType"
              defaultValue={file.docType}
              className="rounded-[10px] border border-line bg-surface px-2 py-[5px] text-[11.5px] text-ink"
            >
              {DOC_TYPES.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </AutoSubmitSelect>
          </form>
          <TagsDialog
            projectId={projectId}
            fileId={file.id}
            fileName={file.fileName}
            tags={file.tags}
            suggestions={tags}
          />
          {folders.length > 0 ? (
            <form action={moveFile} className="shrink-0">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="fileId" value={file.id} />
              <AutoSubmitSelect
                name="folderId"
                defaultValue={file.folderId ?? ""}
                className="max-w-[160px] rounded-[10px] border border-line bg-surface px-2 py-[5px] text-[11.5px] text-ink"
              >
                <option value="">Top level</option>
                {folderOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.path}
                  </option>
                ))}
              </AutoSubmitSelect>
            </form>
          ) : null}
          <form action={removeFile}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="fileId" value={file.id} />
            <button type="submit" aria-label="Remove" className="cursor-pointer text-faint hover:text-bad-fg">
              <Icon name="close" size={14} />
            </button>
          </form>
        </div>
      ))}
    </TableCard>
  );
}
