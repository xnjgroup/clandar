import { ApiError, UUID } from "@/lib/api";
import { listTeam } from "@/lib/auth";
import { getProject } from "@/lib/projects";

export type ScheduleBody = {
  notes?: string;
  location?: string;
  startsAt?: string;
  endsAt?: string;
  assignedTo?: string | null;
  projectId?: string | null;
};

/** Validates a create/update body against this org; returns the fields that were sent. */
export async function scheduleFields(orgId: string, body: ScheduleBody) {
  const out: {
    notes?: string;
    location?: string;
    startsAt?: Date;
    endsAt?: Date;
    assignedTo?: string | null;
    projectId?: string | null;
  } = {};
  if (body.notes !== undefined) out.notes = String(body.notes).trim();
  if (body.location !== undefined) out.location = String(body.location).trim();
  if (body.startsAt !== undefined || body.endsAt !== undefined) {
    const startsAt = new Date(body.startsAt ?? "");
    const endsAt = new Date(body.endsAt ?? "");
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new ApiError(400, "Send startsAt and endsAt as ISO times.");
    if (endsAt <= startsAt) throw new ApiError(400, "The end must be after the start.");
    out.startsAt = startsAt;
    out.endsAt = endsAt;
  }
  if (body.assignedTo !== undefined) {
    const id = body.assignedTo && UUID.test(body.assignedTo) ? body.assignedTo : null;
    if (id && !(await listTeam(orgId)).some((m) => m.id === id)) throw new ApiError(400, "Unknown team member.");
    out.assignedTo = id;
  }
  if (body.projectId !== undefined) {
    const id = body.projectId && UUID.test(body.projectId) ? body.projectId : null;
    if (id && !(await getProject(id, orgId))) throw new ApiError(400, "Unknown project.");
    out.projectId = id;
  }
  return out;
}

