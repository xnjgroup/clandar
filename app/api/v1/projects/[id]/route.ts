import { NextResponse } from "next/server";
import { api, ApiError, apiSession, idParam, jsonBody, optionalText, UUID, YMD } from "@/lib/api";
import { listTeam } from "@/lib/auth";
import { listProjectInvoices } from "@/lib/email-invoice";
import { listProjectComments, projectRefs } from "@/lib/project-comments";
import { listAllProjectFiles, listProjectPhotos } from "@/lib/project-photos";
import {
  assignProject,
  deleteProject,
  getProject,
  PROJECT_STATUSES,
  setProjectStatus,
  updateProject,
  type ProjectStatus,
} from "@/lib/projects";
import { listEstimates } from "@/lib/quoting";
import { listSchedule } from "@/lib/schedule";
import { listTasks } from "@/lib/tasks";

type Context = { params: Promise<{ id: string }> };
const YEAR = 365 * 24 * 60 * 60 * 1000;

/**
 * GET → the project hub: the project, its schedule (a year either side), tasks, estimates, photos,
 * files, linked invoices, and its Discussion — `comments` (flat, oldest first; nest by parentId) and
 * `refs`, the things a comment can #-reference (and what existing references resolve to). Photo/file bytes come from /api/projects/{id}/photos|files/{fileId}.
 */
export const GET = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Project");
  const project = await getProject(id, org.id);
  if (!project) throw new ApiError(404, "Project not found.");
  const now = Date.now();
  const [schedule, tasks, estimates, photos, files, invoices, comments, refs] = await Promise.all([
    listSchedule(org.id, { from: new Date(now - YEAR), to: new Date(now + YEAR) }, { projectId: id }),
    listTasks(org.id, { projectId: id, includeDone: true }),
    listEstimates(id),
    listProjectPhotos(id),
    listAllProjectFiles(id),
    listProjectInvoices(id, org.id),
    listProjectComments(id, org.id),
    projectRefs(id, org.id),
  ]);
  return NextResponse.json({
    project,
    comments,
    refs,
    schedule,
    tasks,
    estimates,
    // Storage paths stay on the server.
    photos: photos.map(({ id, caption, contentType, createdAt }) => ({ id, caption, contentType, createdAt })),
    files: files.map(({ id, fileName, contentType, sizeBytes, tags, docType, folderId, createdAt }) => ({
      id,
      fileName,
      contentType,
      sizeBytes,
      tags,
      docType,
      folderId,
      createdAt,
    })),
    invoices,
  });
});

/** PATCH { status?, title?, projectTypeId?, address?, notes?, dueDate?, assignedTo? } — only what's sent changes. */
export const PATCH = api(async (request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Project");
  const project = await getProject(id, org.id);
  if (!project) throw new ApiError(404, "Project not found.");
  const body = await jsonBody<Record<string, unknown>>(request);

  if (body.status !== undefined) {
    const status = body.status as ProjectStatus;
    if (!PROJECT_STATUSES.some((s) => s.id === status)) throw new ApiError(400, "Unknown status.");
    await setProjectStatus(id, org.id, status);
  }
  if (body.assignedTo !== undefined) {
    const assignedTo = typeof body.assignedTo === "string" && UUID.test(body.assignedTo) ? body.assignedTo : null;
    if (assignedTo && !(await listTeam(org.id)).some((m) => m.id === assignedTo)) throw new ApiError(400, "Unknown team member.");
    await assignProject(id, org.id, assignedTo);
  }
  const title = optionalText(body.title);
  const address = optionalText(body.address);
  const notes = optionalText(body.notes);
  const dueDate = optionalText(body.dueDate);
  const typeId = optionalText(body.projectTypeId);
  if ([title, address, notes, dueDate, typeId].some((v) => v !== undefined)) {
    if (title === "") throw new ApiError(400, "The title can't be empty.");
    await updateProject(id, org.id, {
      title: title ?? project.title,
      projectTypeId: typeId === undefined ? project.projectTypeId : typeId && UUID.test(typeId) ? typeId : null,
      address: address ?? project.address,
      notes: notes ?? project.notes,
      dueDate: dueDate === undefined ? project.dueDate : dueDate && YMD.test(dueDate) ? dueDate : null,
    });
  }
  return NextResponse.json({ project: await getProject(id, org.id) });
});

/** DELETE → removes the project and everything on it (photos, files, estimates, schedule, tasks). */
export const DELETE = api(async (_request: Request, { params }: Context) => {
  const { org } = await apiSession();
  const id = await idParam(params, "Project");
  if (!(await getProject(id, org.id))) throw new ApiError(404, "Project not found.");
  await deleteProject(id, org.id);
  return NextResponse.json({ ok: true });
});
