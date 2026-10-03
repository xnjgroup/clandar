import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { saveArticle } from "@/lib/web-article";

// Reading a page and summarizing it takes up to half a minute or so.
export const maxDuration = 120;

/** POST { url, tags? } — saves a web article to the Library (read, summarized, indexed) → { article }. */
export const POST = api(async (request: Request) => {
  const session = await apiSession();
  const body = await jsonBody<{ url?: string; tags?: string[] }>(request);
  const url = body.url?.trim() ?? "";
  if (!/^https?:\/\//i.test(url)) throw new ApiError(400, "Paste the article's full link (https://…).");
  try {
    const article = await saveArticle(session.org.id, session.person.id, url, Array.isArray(body.tags) ? body.tags.map(String) : []);
    return NextResponse.json({ article });
  } catch (error) {
    throw new ApiError(422, error instanceof Error ? error.message : "Couldn't read that page.");
  }
});
