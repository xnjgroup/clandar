import { NextResponse } from "next/server";
import { api, apiSession } from "@/lib/api";
import { listTeam } from "@/lib/auth";
import { PROJECT_STATUSES } from "@/lib/projects";
import { listProjectTypes } from "@/lib/project-types";

/** GET → the pickers' options: project types, team members (for assigning), project statuses. */
export const GET = api(async () => {
  const { org } = await apiSession();
  const [projectTypes, team] = await Promise.all([listProjectTypes(org.id), listTeam(org.id)]);
  return NextResponse.json({
    projectTypes: projectTypes.map(({ id, name, icon }) => ({ id, name, icon })),
    team: team.map(({ id, name, email, role }) => ({ id, name, email, role })),
    statuses: PROJECT_STATUSES,
  });
});
