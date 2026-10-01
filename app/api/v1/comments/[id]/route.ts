import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody } from "@/lib/api";
import { deleteProjectComment, updateProjectComment } from "@/lib/project-comments";

type Context = { params: Promise<{ id: string }> };

const status = (error: string) => (error.endsWith("not found.") ? 404 : error.startsWith("Only") ? 403 : 400);

/** PATCH { body } — edit your own comment (newly mentioned people are notified). */
export const PATCH = api(async (request: Request, { params }: Context) => {
  const { org, person } = await apiSession();
  const id = await idParam(params, "Comment");
  const { body } = await jsonBody<{ body?: string }>(request);
  const result = await updateProjectComment(org.id, id, { id: person.id, name: person.name || person.email }, body ?? "");
  if ("error" in result) throw new ApiError(status(result.error), result.error);
  return NextResponse.json({ ok: true });
});

/** DELETE — your comment (or any, as an owner); one with replies becomes "[deleted]" so the thread stays. */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const { org, person } = await apiSession();
  const result = await deleteProjectComment(org.id, await idParam(params, "Comment"), { id: person.id, role: person.role });
  if ("error" in result) throw new ApiError(status(result.error), result.error);
  return NextResponse.json({ ok: true });
});
