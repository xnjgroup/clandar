import Link from "next/link";
import { after } from "next/server";
import { HeaderActions } from "@/components/header-actions";
import { Icon, type IconName } from "@/components/icons";
import { EmptyRow, PageBody, SearchForm, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { firstParam, relativeTime } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { libraryCounts, listLibrary, searchLibrary, syncLibrary, type LibraryFilter, type LibraryItem } from "@/lib/library";
import { listProjects } from "@/lib/projects";
import { removeLibraryItem } from "./actions";
import { LibraryUploadDialog } from "./upload-dialog";

/** The file-type icon and label for a row. */
function fileKind(item: LibraryItem): { icon: IconName; label: string } {
  const name = (item.fileName ?? "").toLowerCase();
  const type = item.contentType ?? "";
  if (item.kind === "article") return { icon: "map", label: "Article" };
  if (type === "application/pdf" || name.endsWith(".pdf")) return { icon: "doc", label: "PDF" };
  if (type.startsWith("image/")) return { icon: "camera", label: "Image" };
  if (/\.(xlsx|xls|csv)$/.test(name)) return { icon: "grid", label: "Spreadsheet" };
  if (/\.(docx|doc|md|txt)$/.test(name)) return { icon: "pencil", label: "Document" };
  if (/\.(pptx|ppt)$/.test(name)) return { icon: "layers", label: "Slides" };
  if (name.endsWith(".eml")) return { icon: "mail", label: "Email" };
  return { icon: "doc", label: "File" };
}

function size(bytes: number | null): string {
  if (!bytes) return "";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const TABS = [
  { id: "", label: "Everything" },
  { id: "project_file", label: "Project files" },
  { id: "file", label: "My documents" },
  { id: "article", label: "Articles" },
] as const;

/**
 * The Library: every project's files and documents uploaded here, searchable by their full text
 * (English and Chinese) — the same search the assistant uses.
 */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org } = await requireSession();
  const params = await searchParams;
  const q = firstParam(params.q).trim();
  const kind = firstParam(params.kind);
  const projectId = firstParam(params.project);
  const filter: LibraryFilter = {
    ...(kind === "project_file" || kind === "file" || kind === "article" ? { kind } : {}),
    ...(projectId ? { projectId } : {}),
  };

  // Mirror project files added since the last look, and read a few waiting ones, after the page is sent.
  after(() => syncLibrary(org.id, 10).catch(() => 0));

  const [items, counts, projects] = await Promise.all([
    q ? searchLibrary(org.id, q, filter, 50) : listLibrary(org.id, filter, 100),
    libraryCounts(org.id),
    listProjects(org.id),
  ]);
  const projectsWithFiles = projects; // the filter lists every project; empty ones simply show nothing

  const href = (patch: Record<string, string>) => {
    const next = new URLSearchParams({ ...(q ? { q } : {}), ...(kind ? { kind } : {}), ...(projectId ? { project: projectId } : {}), ...patch });
    for (const [k, v] of [...next.entries()]) if (!v) next.delete(k);
    const s = next.toString();
    return s ? `/library?${s}` : "/library";
  };

  return (
    <PageBody>
      <HeaderActions>
        <LibraryUploadDialog />
      </HeaderActions>

      <SearchForm
        action="/library"
        placeholder="Search every document — words, “a phrase”, -exclude… English or 中文"
        defaultValue={q}
        keep={{ kind, project: projectId }}
      />

      <div className="flex flex-wrap items-center gap-[8px]">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={href({ kind: t.id })}
            className={`rounded-full px-[13px] py-[6px] text-[12.5px] font-medium ${
              kind === t.id ? "bg-ink text-bg" : "border border-line bg-surface text-body-soft"
            }`}
          >
            {t.label}
          </Link>
        ))}
        <form action="/library" method="get" className="ml-auto flex items-center gap-[6px]">
          {q ? <input type="hidden" name="q" value={q} /> : null}
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          <select
            name="project"
            defaultValue={projectId}
            className="h-[34px] rounded-[10px] border border-line bg-surface px-2 text-[12.5px]"
            aria-label="Project"
          >
            <option value="">All projects</option>
            {projectsWithFiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <button type="submit" className="h-[34px] cursor-pointer rounded-[10px] border border-line bg-surface px-3 text-[12.5px] font-medium">
            Filter
          </button>
        </form>
      </div>

      <TableCard>
        <TableHeader>
          <TableTitle>{q ? `Results for “${q}”` : "Newest first"}</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {q ? `${items.length} found` : `${counts.total} document${counts.total === 1 ? "" : "s"}`}
            {counts.pending ? ` · ${counts.pending} being read` : ""}
          </span>
        </TableHeader>
        {items.length === 0 ? (
          <EmptyRow>
            {q
              ? `Nothing matches “${q}”. Try fewer words, or one word in the document's own language.`
              : counts.total === 0
                ? "Nothing here yet — files you add to projects show up here, or add documents with the + above."
                : "Nothing matches this filter."}
          </EmptyRow>
        ) : (
          items.map((item) => {
            const type = fileKind(item);
            const open =
              item.kind === "article"
                ? `/library/${item.id}`
                : item.kind === "project_file" && item.projectId && item.projectFileId
                  ? `/api/projects/${item.projectId}/files/${item.projectFileId}`
                  : `/api/library/${item.id}/file`;
            const hit = "snippet" in item ? (item as LibraryItem & { snippet: string; page: number | null }) : null;
            return (
              <div key={item.id} className="flex min-w-0 items-start gap-3 border-t border-line-soft px-[18px] py-[13px] hover:bg-[#fafbf9]">
                <span className="mt-[2px] flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-[#f2f4ef] text-[#4c4f47]">
                  <Icon name={type.icon} size={16} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[3px] leading-[1.4]">
                  <a
                    href={open}
                    {...(item.kind === "article" ? {} : { target: "_blank", rel: "noopener" })}
                    className="truncate text-[13.5px] font-semibold hover:underline"
                  >
                    {item.title}
                  </a>
                  <span className="flex flex-wrap items-center gap-x-[8px] text-[11.5px] text-muted">
                    {item.projectId ? (
                      <Link href={`/projects/${item.projectId}`} className="font-medium text-body-soft hover:underline">
                        {item.projectTitle}
                      </Link>
                    ) : (
                      <span className="font-medium text-body-soft">{item.kind === "article" ? (item.url ? new URL(item.url).hostname.replace(/^www\./, "") : "Article") : "My documents"}</span>
                    )}
                    <span>{type.label}</span>
                    {item.sizeBytes ? <span>{size(item.sizeBytes)}</span> : null}
                    <span>{relativeTime(item.createdAt)}</span>
                    {hit?.page ? <span>page {hit.page}</span> : null}
                    {item.tags.map((t) => (
                      <span key={t} className="rounded-full bg-idle-bg px-[7px] py-[1px] text-[10.5px]">
                        #{t}
                      </span>
                    ))}
                  </span>
                  {hit?.snippet ? (
                    <p
                      className="m-0 line-clamp-3 text-[12px] text-body-soft [&_mark]:rounded-[3px] [&_mark]:bg-lime [&_mark]:px-[2px] [&_mark]:text-ink"
                      // pgroonga_snippet_html escapes the text; only <mark> is added (lib/library.ts).
                      dangerouslySetInnerHTML={{ __html: hit.snippet }}
                    />
                  ) : null}
                  {item.status === "pending" ? <span className="text-[11px] text-faint">Being read for search…</span> : null}
                  {item.status === "skipped" || item.status === "failed" ? (
                    <span className="text-[11px] text-faint">Not searchable by its text: {item.statusDetail}</span>
                  ) : null}
                </div>
                {item.kind !== "project_file" ? (
                  <form action={removeLibraryItem}>
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" className="cursor-pointer text-[11.5px] text-bad-fg hover:underline" aria-label={`Delete ${item.title}`}>
                      Delete
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })
        )}
      </TableCard>
    </PageBody>
  );
}
