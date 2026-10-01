import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody } from "@/lib/api";
import { setLeadStatus } from "@/lib/lead-finder";
import { convertLeadToProject, dismissLead, followUpOnLead } from "@/lib/lead-handling";
import { validTimeZone } from "@/lib/time-zone";

type Context = { params: Promise<{ id: string }> };

/**
 * POST { action: "project" | "followUp" | "dismiss" | "restore", timeZone? } — the lead's buttons.
 * "project" returns { projectId }.
 */
export const POST = api(async (request: Request, { params }: Context) => {
  const { org, person } = await apiSession();
  const id = await idParam(params, "Lead");
  const { action, timeZone } = await jsonBody<{ action?: string; timeZone?: string }>(request);
  switch (action) {
    case "project": {
      const projectId = await convertLeadToProject(org.id, person.id, id);
      if (!projectId) throw new ApiError(404, "Lead not found.");
      return NextResponse.json({ projectId });
    }
    case "followUp":
      if (!(await followUpOnLead(org.id, person.id, id, validTimeZone(timeZone)))) throw new ApiError(404, "Lead not found.");
      return NextResponse.json({ ok: true });
    case "dismiss":
      if (!(await dismissLead(org.id, id))) throw new ApiError(404, "Lead not found.");
      return NextResponse.json({ ok: true });
    case "restore":
      await setLeadStatus(id, org.id, "new");
      return NextResponse.json({ ok: true });
    default:
      throw new ApiError(400, "Unknown action.");
  }
});
