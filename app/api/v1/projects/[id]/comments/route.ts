import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody, UUID } from "@/lib/api";
import { addProjectComment } from "@/lib/project-comments";

type Context = { params: Promise<{ id: string }> };

/**
 * POST { body, parentId? } → { id } — a comment on the project's Discussion, or a reply. The body uses
 * <@person-uuid> for mentions (notified) and <#kind:uuid> for references (lib/comment-text.ts).
 */
export const POST = api(async (request: Request, { params }: Context) => {
  const { org, person } = await apiSession();
  const projectId = await idParam(params, "Project");
  const body = await jsonBody<{ body?: string; parentId?: string | null }>(request);
  if (body.parentId && !UUID.test(body.parentId)) throw new ApiError(400, "Bad parentId.");
  const result = await addProjectComment(org.id, projectId, { id: person.id, name: person.name || person.email }, body.body ?? "", body.parentId ?? null);
  if ("error" in result) throw new ApiError(result.error === "Project not found." ? 404 : 400, result.error);
  return NextResponse.json(result, { status: 201 });
});
