import { NextResponse, after } from "next/server";
import { api, ApiError, apiSession, UUID } from "@/lib/api";
import {
  addLibraryFile,
  indexLibraryItem,
  libraryCounts,
  listLibrary,
  searchLibrary,
  syncLibrary,
  type LibraryFilter,
  type LibraryItem,
} from "@/lib/library";
import { parseTags } from "@/lib/project-photos";

export const maxDuration = 120;

/** A Library item for the app — `fileUrl` is the API path to its bytes. */
function itemJson(item: LibraryItem & { snippet?: string; page?: number | null }) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    fileName: item.fileName,
    contentType: item.contentType,
    sizeBytes: item.sizeBytes,
    tags: item.tags,
    status: item.status,
    statusDetail: item.statusDetail,
    createdAt: item.createdAt,
    projectId: item.projectId,
    projectTitle: item.projectTitle,
    url: item.url,
    summary: item.summary,
    // Plain-text snippet for the app (matches in «…» is overkill — just strip the marks and entities).
    snippet: item.snippet
      ? item.snippet.replace(/<\/?mark>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
      : null,
    page: item.page ?? null,
    fileUrl: `api/library/${item.id}/file`,
  };
}

/** GET ?q=&kind=project_file|file|article&projectId= → { items, total, pending } — search when q is given, else newest first. */
export const GET = api(async (request: Request) => {
  const { org } = await apiSession();
  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  const kind = params.get("kind");
  const projectId = params.get("projectId");
  const filter: LibraryFilter = {
    ...(kind === "project_file" || kind === "file" || kind === "article" ? { kind } : {}),
    ...(projectId && UUID.test(projectId) ? { projectId } : {}),
  };
  after(() => syncLibrary(org.id, 10).catch(() => 0));
  const [items, counts] = await Promise.all([q ? searchLibrary(org.id, q, filter, 50) : listLibrary(org.id, filter, 100), libraryCounts(org.id)]);
  return NextResponse.json({ items: items.map(itemJson), total: counts.total, pending: counts.pending });
});

/** POST multipart { file, tags? } — adds a document to the Library and reads it for search → { id }. */
export const POST = api(async (request: Request) => {
  const session = await apiSession();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "Choose a file first.");
  if (file.size > 50 * 1024 * 1024) throw new ApiError(400, `${file.name} is over 50 MB.`);
  const tags = form.get("tags");
  const id = await addLibraryFile({
    orgId: session.org.id,
    folderId: null,
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    bytes: Buffer.from(await file.arrayBuffer()),
    createdBy: session.person.id,
    tags: parseTags(typeof tags === "string" ? tags : ""),
  });
  after(() => indexLibraryItem(id));
  return NextResponse.json({ id });
});
