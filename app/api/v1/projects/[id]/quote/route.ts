import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody } from "@/lib/api";
import { listProjectPhotos } from "@/lib/project-photos";
import { getProject } from "@/lib/projects";
import { analyzeProjectPhotos, createEstimate, type LineItemKind } from "@/lib/quoting";

export const maxDuration = 120;
type Context = { params: Promise<{ id: string }> };

/**
 * POST {} → the AI's proposed estimate from the project's photos (nothing saved);
 * POST { save: { summary, lineItems } } → saves that (possibly edited) proposal as a draft estimate.
 * Estimates are never sent from here — sending stays a deliberate step on the web.
 */
export const POST = api(async (request: Request, { params }: Context) => {
  const { org, person } = await apiSession();
  const id = await idParam(params, "Project");
  const project = await getProject(id, org.id);
  if (!project) throw new ApiError(404, "Project not found.");
  const body = await jsonBody<{
    save?: { summary?: string; lineItems?: { description?: string; quantity?: number; unitPrice?: number; kind?: LineItemKind }[] };
  }>(request);

  if (body.save) {
    const lineItems = (body.save.lineItems ?? [])
      .filter((l) => l.description?.trim())
      .map((l) => ({
        description: l.description!.trim(),
        quantity: Number(l.quantity) || 1,
        unitPrice: Number(l.unitPrice) || 0,
        kind: (["labor", "material", "other"] as const).includes(l.kind as LineItemKind) ? (l.kind as LineItemKind) : "other",
      }));
    if (lineItems.length === 0) throw new ApiError(400, "Add at least one line item.");
    const estimateId = await createEstimate({
      orgId: org.id,
      projectId: id,
      summary: body.save.summary?.trim() ?? "",
      lineItems,
      aiGenerated: true,
      createdBy: person.id,
    });
    return NextResponse.json({ id: estimateId }, { status: 201 });
  }

  const photos = await listProjectPhotos(id);
  const proposal = await analyzeProjectPhotos(
    org.id,
    { title: project.title, projectType: project.projectTypeName ?? "general", address: project.address, notes: project.notes },
    photos,
  ).catch((e: Error) => {
    throw new ApiError(422, e.message);
  });
  return NextResponse.json({ proposal });
});
