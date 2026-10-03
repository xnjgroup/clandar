import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam } from "@/lib/api";
import { convert } from "html-to-text";
import { deleteLibraryItem, getLibraryItem } from "@/lib/library";

type Context = { params: Promise<{ id: string }> };

/**
 * A saved article for the app as blocks — paragraphs of text and pictures in order (the app shows
 * them natively rather than rendering HTML). Picture paths are API paths (the app sends its token).
 */
function articleBlocks(html: string): ({ type: "text"; text: string } | { type: "image"; path: string })[] {
  const blocks: ({ type: "text"; text: string } | { type: "image"; path: string })[] = [];
  for (const part of html.split(/(<img\b[^>]*>)/i)) {
    const src = /^<img\b[^>]*\bsrc="(\/api\/library\/[0-9a-f-]+\/images\/\d+)"/i.exec(part)?.[1];
    if (src) {
      blocks.push({ type: "image", path: src.slice(1) });
      continue;
    }
    const text = convert(part, { wordwrap: false, selectors: [{ selector: "a", options: { ignoreHref: true } }] }).replace(/\n{3,}/g, "\n\n").trim();
    if (text) blocks.push({ type: "text", text });
  }
  return blocks;
}

/** GET → { item } — a document or saved article with its text, summary, source and dates. */
export const GET = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Document");
  const item = await getLibraryItem(id, org.id);
  if (!item) throw new ApiError(404, "Not found.");
  const { filePath: _path, images: _images, contentHtml, ...rest } = item;
  void _path;
  void _images;
  return NextResponse.json({ item: { ...rest, fileUrl: `api/library/${item.id}/file`, blocks: contentHtml ? articleBlocks(contentHtml) : null } });
});

/** DELETE — removes a document uploaded to the Library (a project's file is deleted from its project). */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Document");
  if (!(await deleteLibraryItem(id, org.id))) throw new ApiError(404, "Not found — a project's file is removed from its project.");
  return NextResponse.json({ ok: true });
});
