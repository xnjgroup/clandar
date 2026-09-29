import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { Card, CardTitle, EmptyRow, PageBody, Pill, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { count, money, relativeTime, type Tone } from "@/lib/data";
import { listTeam, requireSession } from "@/lib/auth";
import { getConnector, listGmailConnectors, hasGmailModifyScope } from "@/lib/connectors";
import { PROJECT_STATUSES, getProject, type ProjectStatus } from "@/lib/projects";
import { listProjectTypes } from "@/lib/project-types";
import { listProjectFiles, listProjectPhotos } from "@/lib/project-photos";
import { listEstimates } from "@/lib/quoting";
import { listSchedule } from "@/lib/schedule";
import { listTasks } from "@/lib/tasks";
import { AddTaskForm } from "../../tasks/add-task-form";
import { TaskList } from "../../tasks/task-list";
import { ScheduleForm } from "../../schedule/schedule-form";
import { removeScheduleEntry } from "../../schedule/actions";
import { changeProjectAssignee, changeProjectStatus, removeProject, saveProject } from "../actions";
import { EstimateBuilder } from "./estimate-builder";
import { FileUploadForm } from "./file-upload-form";
import { PhotoLightbox } from "./photo-lightbox";
import { PhotoUploadForm } from "./photo-upload-form";
import { removeEstimate, removeFile, removePhoto } from "./actions";
import { AutoSubmitSelect } from "./auto-submit-select";
import { SendEstimateForm } from "./send-estimate-form";

const STATUS_TONE: Record<ProjectStatus, Tone> = {
  lead: "idle",
  quoted: "warn",
  scheduled: "warn",
  in_progress: "ok",
  completed: "ok",
  cancelled: "bad",
};

const inputClass =
  "w-full rounded-[12px] border border-line bg-surface px-3 py-[10px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function ProjectDetailPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const { org } = await requireSession();
  const project = await getProject(id, org.id);
  if (!project) notFound();

  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const yearAhead = new Date();
  yearAhead.setFullYear(yearAhead.getFullYear() + 1);

  const [team, projectTypes, photos, files, estimates, schedule, tasks, gmailConnectors] = await Promise.all([
    listTeam(org.id),
    listProjectTypes(org.id),
    listProjectPhotos(project.id),
    listProjectFiles(project.id),
    listEstimates(project.id),
    listSchedule(org.id, { from: yearAgo, to: yearAhead }, { projectId: project.id }),
    listTasks(org.id, { projectId: project.id, includeDone: true }),
    listGmailConnectors(org.id),
  ]);

  const sendableConnectors = (
    await Promise.all(gmailConnectors.map(async (c) => ((await getConnector(c.id)) ? c : null)))
  )
    .filter((c): c is NonNullable<typeof c> => c !== null && hasGmailModifyScope(c))
    .map((c) => ({ id: c.id, label: c.accountLabel ?? c.name }));

  return (
    <PageBody>
      <Card className="flex flex-col gap-[13px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <CardTitle>{project.title}</CardTitle>
          <Pill tone={STATUS_TONE[project.status]}>
            {PROJECT_STATUSES.find((s) => s.id === project.status)?.label ?? project.status}
          </Pill>
          <Link href={`/customers/${project.customerId}`} className="text-[12px] font-medium underline">
            {project.customerName}
          </Link>
          <Link href="/projects" className="ml-auto text-[11.5px] font-medium underline">
            All projects
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-[10px]">
          <form action={changeProjectStatus} className="flex items-center gap-[7px]">
            <input type="hidden" name="id" value={project.id} />
            <span className="text-[11px] text-muted">Status</span>
            <AutoSubmitSelect
              name="status"
              defaultValue={project.status}
              className="rounded-[10px] border border-line bg-surface px-2 py-[6px] text-[12px] text-ink"
            >
              {PROJECT_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </AutoSubmitSelect>
          </form>
          <form action={changeProjectAssignee} className="flex items-center gap-[7px]">
            <input type="hidden" name="id" value={project.id} />
            <span className="text-[11px] text-muted">Assigned to</span>
            <AutoSubmitSelect
              name="assignedTo"
              defaultValue={project.assignedTo ?? ""}
              className="rounded-[10px] border border-line bg-surface px-2 py-[6px] text-[12px] text-ink"
            >
              <option value="">Unassigned</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </AutoSubmitSelect>
          </form>
        </div>

        <form action={saveProject} className="grid grid-cols-1 gap-[10px] lg:grid-cols-2">
          <input type="hidden" name="id" value={project.id} />
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11px] text-muted">Title</span>
            <input name="title" defaultValue={project.title} required className={inputClass} />
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11px] text-muted">Project type</span>
            <select name="projectTypeId" defaultValue={project.projectTypeId ?? ""} className={inputClass}>
              <option value="">None</option>
              {projectTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-[5px] lg:col-span-2">
            <span className="text-[11px] text-muted">Project site address</span>
            <input name="address" defaultValue={project.address} className={inputClass} />
          </label>
          <label className="flex flex-col gap-[5px] lg:col-span-2">
            <span className="text-[11px] text-muted">Notes</span>
            <textarea name="notes" rows={2} defaultValue={project.notes} className={inputClass} />
          </label>
          <div className="flex items-center gap-[10px] lg:col-span-2">
            <button type="submit" className="cursor-pointer rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg">
              Save
            </button>
            <span className="text-[11px] text-faint">Updated {relativeTime(project.updatedAt)}</span>
            <button
              type="submit"
              formAction={removeProject}
              className="ml-auto cursor-pointer text-[11.5px] font-medium text-bad-fg underline"
            >
              Delete project
            </button>
          </div>
        </form>
      </Card>

      {/* Quoting */}
      <TableCard>
        <TableHeader>
          <TableTitle>Photos & quoting</TableTitle>
          <span className="ml-auto font-mono text-[10.5px] text-faint">{count(photos.length)} photo{photos.length === 1 ? "" : "s"}</span>
        </TableHeader>
        <div className="flex flex-col gap-[12px] border-t border-line-soft px-[18px] py-[14px]">
          <PhotoUploadForm projectId={project.id} />
          <PhotoLightbox
            projectId={project.id}
            removePhoto={removePhoto}
            photos={photos.map((photo) => ({
              id: photo.id,
              url: `/api/projects/${project.id}/photos/${photo.id}`,
              caption: photo.caption,
            }))}
          />
          <EstimateBuilder projectId={project.id} photoCount={photos.length} />
        </div>

        {estimates.length === 0 ? (
          <EmptyRow>No estimates yet.</EmptyRow>
        ) : (
          estimates.map((estimate) => (
            <div key={estimate.id} className="flex flex-col gap-[8px] border-t border-line-soft px-[18px] py-[13px]">
              <div className="flex flex-wrap items-center gap-[9px]">
                <span className="text-[13px] font-semibold">{money(estimate.total)}</span>
                <Pill tone={estimate.status === "sent" || estimate.status === "accepted" ? "ok" : "idle"}>
                  {estimate.status}
                </Pill>
                {estimate.aiGenerated ? (
                  <span className="rounded-full bg-idle-bg px-2 py-[2px] font-mono text-[9.5px] text-body-soft">
                    AI-drafted
                  </span>
                ) : null}
                <span className="text-[11px] text-faint">{relativeTime(estimate.createdAt)}</span>
                <form action={removeEstimate} className="ml-auto">
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="estimateId" value={estimate.id} />
                  <button type="submit" className="cursor-pointer text-[11px] font-medium text-bad-fg underline">
                    Delete
                  </button>
                </form>
              </div>
              <p className="m-0 text-[12px] leading-[1.5] text-body-soft">{estimate.summary}</p>
              <ul className="m-0 flex flex-col gap-[2px] pl-[18px] text-[11.5px] text-muted">
                {estimate.lineItems.map((li) => (
                  <li key={li.id}>
                    {li.description} — {li.quantity} × {money(li.unitPrice)}
                  </li>
                ))}
              </ul>
              {estimate.status === "draft" ? (
                <SendEstimateForm
                  projectId={project.id}
                  estimateId={estimate.id}
                  connectors={sendableConnectors}
                  customerEmail={project.customerEmail}
                />
              ) : estimate.sentAt ? (
                <span className="text-[11px] text-faint">Sent {relativeTime(estimate.sentAt)}</span>
              ) : null}
            </div>
          ))
        )}
      </TableCard>

      {/* Scheduling */}
      <TableCard>
        <TableHeader>
          <TableTitle>Schedule</TableTitle>
        </TableHeader>
        <div className="border-t border-line-soft px-[18px] py-[13px]">
          <ScheduleForm projectId={project.id} members={team} redirectPath={`/projects/${project.id}`} />
        </div>
        {schedule.length === 0 ? (
          <EmptyRow>Not scheduled yet.</EmptyRow>
        ) : (
          schedule.map((entry) => (
            <div key={entry.id} className="flex min-h-[52px] items-center gap-3 border-t border-line-soft px-[18px] py-[11px]">
              <Icon name="calendar" size={16} className="shrink-0 text-body-soft" />
              <span className="text-[12.5px] font-medium">
                {entry.startsAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </span>
              <span className="font-mono text-[11.5px] text-muted">
                {entry.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} –{" "}
                {entry.endsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </span>
              {entry.assignedName ? (
                <span className="flex items-center gap-[5px] text-[11.5px] text-muted">
                  <Icon name="user" size={12} />
                  {entry.assignedName}
                </span>
              ) : null}
              <form action={removeScheduleEntry} className="ml-auto">
                <input type="hidden" name="id" value={entry.id} />
                <input type="hidden" name="redirectPath" value={`/projects/${project.id}`} />
                <button type="submit" aria-label="Remove" className="cursor-pointer text-faint hover:text-bad-fg">
                  <Icon name="close" size={14} />
                </button>
              </form>
            </div>
          ))
        )}
      </TableCard>

      {/* Tasks */}
      <TableCard>
        <TableHeader>
          <TableTitle>Tasks</TableTitle>
        </TableHeader>
        <div className="border-t border-line-soft px-[18px] py-[13px]">
          <AddTaskForm projectId={project.id} redirectPath={`/projects/${project.id}`} members={team} />
        </div>
        <TaskList tasks={tasks} redirectPath={`/projects/${project.id}`} emptyLabel="No tasks yet." />
      </TableCard>

      {/* Project records: files */}
      <TableCard>
        <TableHeader>
          <TableTitle>Files</TableTitle>
        </TableHeader>
        <div className="border-t border-line-soft px-[18px] py-[13px]">
          <FileUploadForm projectId={project.id} />
        </div>
        {files.length === 0 ? (
          <EmptyRow>No files yet — permits, contracts, receipts.</EmptyRow>
        ) : (
          files.map((file) => (
            <div key={file.id} className="flex min-h-[52px] items-center gap-3 border-t border-line-soft px-[18px] py-[11px]">
              <Icon name="doc" size={16} className="shrink-0 text-body-soft" />
              <a
                href={`/api/projects/${project.id}/files/${file.id}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-[12.5px] font-medium underline"
              >
                {file.fileName}
              </a>
              <span className="shrink-0 font-mono text-[11px] text-faint">{fileSize(file.sizeBytes)}</span>
              <form action={removeFile}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="fileId" value={file.id} />
                <button type="submit" aria-label="Remove" className="cursor-pointer text-faint hover:text-bad-fg">
                  <Icon name="close" size={14} />
                </button>
              </form>
            </div>
          ))
        )}
      </TableCard>
    </PageBody>
  );
}
