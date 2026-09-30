import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Icon } from "@/components/icons";
import { TimeZoneField } from "@/components/time-zone-field";
import { Card, CardTitle, EmptyRow, PageBody, Pill, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { count, money, relativeTime, shortDate, statusLabel, statusTone, type Tone } from "@/lib/data";
import { listTeam, requireSession } from "@/lib/auth";
import { getConnector, listGmailConnectors, hasGmailModifyScope } from "@/lib/connectors";
import { PROJECT_STATUSES, describeDue, getProject, type ProjectStatus } from "@/lib/projects";
import { listProjectTypes } from "@/lib/project-types";
import { listAllProjectFiles, listProjectPhotos } from "@/lib/project-photos";
import { getLetterhead } from "@/lib/letterhead";
import { listProjectInvoices } from "@/lib/email-invoice";
import { listEstimates, type Estimate } from "@/lib/quoting";
import { listSchedule, locateScheduleEntries } from "@/lib/schedule";
import { listTasks } from "@/lib/tasks";
import { NewTaskDialog } from "../../tasks/new-task-dialog";
import { TaskList } from "../../tasks/task-list";
import { AddToScheduleDialog } from "../../schedule/add-to-schedule-dialog";
import { ScheduleViews } from "../../schedule/schedule-timeline";
import { changeProjectAssignee, changeProjectStatus, saveProject } from "../actions";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { EditableEstimate } from "./editable-estimate";
import { EstimateBuilder } from "./estimate-builder";
import { PhotoLightbox } from "./photo-lightbox";
import { FilesSection } from "./files-section";
import { UploadForm } from "./upload-form";
import { answerEstimate, convertEstimateToTasks, removeEstimate, removePhoto } from "./actions";
import { AutoSubmitSelect } from "./auto-submit-select";
import { SendEstimateDialog } from "./send-estimate-dialog";

// Server actions here can parse an invoice/receipt after responding (`after`) — give that room.
export const maxDuration = 120;

const STATUS_TONE: Record<ProjectStatus, Tone> = {
  lead: "idle",
  quoted: "warn",
  scheduled: "warn",
  in_progress: "ok",
  completed: "ok",
  cancelled: "bad",
};

/**
 * The customer's answer on a sent estimate — mark it accepted/declined (or undo) —
 * and, once accepted, turning its lines into the project's work tasks.
 */
function EstimateOutcome({
  projectId,
  estimate,
  hasQuoteTasks,
}: {
  projectId: string;
  estimate: Estimate;
  /** The project already has Work/Materials tasks built from some estimate (this one or an earlier one). */
  hasQuoteTasks: boolean;
}) {
  if (estimate.status === "draft") return null;
  const work = estimate.lineItems.filter((l) => l.kind !== "material").length;
  const materials = estimate.lineItems.length - work;
  const answer = (value: "accepted" | "declined" | "sent", label: string, className: string) => (
    <form action={answerEstimate}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="estimateId" value={estimate.id} />
      <input type="hidden" name="answer" value={value} />
      <button type="submit" className={`cursor-pointer rounded-full px-3 py-[6px] text-[11.5px] font-medium ${className}`}>
        {label}
      </button>
    </form>
  );

  return (
    <div className="flex flex-wrap items-center gap-[8px] rounded-[12px] bg-[#fafbf9] px-[10px] py-[8px]">
      {estimate.status === "sent" ? (
        <>
          <span className="text-[11.5px] text-muted">Customer&rsquo;s answer:</span>
          {answer("accepted", "Mark accepted", "bg-ok-bg text-ok-fg")}
          {answer("declined", "Mark declined", "border border-line text-bad-fg")}
        </>
      ) : (
        <>
          <span className={`text-[11.5px] font-semibold ${estimate.status === "accepted" ? "text-ok-fg" : "text-bad-fg"}`}>
            {estimate.status === "accepted" ? "Accepted by the customer" : "Declined by the customer"}
          </span>
          {estimate.tasksCreatedAt ? null : answer("sent", "Undo", "text-muted underline")}
        </>
      )}

      {estimate.status === "accepted" && estimate.lineItems.length > 0 ? (
        <form action={convertEstimateToTasks} className="ml-auto flex flex-wrap items-center justify-end gap-[8px]">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="estimateId" value={estimate.id} />
          <TimeZoneField />
          <span className="text-[11px] text-muted">
            {estimate.tasksCreatedAt ? (
              <>
                Tasks updated {relativeTime(estimate.tasksCreatedAt)} ·{" "}
                <a href="#tasks" className="font-medium text-ink underline">
                  see Tasks below
                </a>
              </>
            ) : (
              [
                work ? `1 to-do (${work} step${work === 1 ? "" : "s"})` : null,
                materials ? `shopping list (${materials} item${materials === 1 ? "" : "s"})` : null,
              ]
                .filter(Boolean)
                .join(" + ")
            )}
          </span>
          <button
            type="submit"
            title="Rebuilds the quote's items in the project's Work and Materials tasks. Ticked items stay ticked; items you added yourself are kept."
            className={`cursor-pointer rounded-full px-3 py-[6px] text-[11.5px] font-semibold ${
              estimate.tasksCreatedAt ? "border border-line text-ink" : "bg-ink text-bg"
            }`}
          >
            {estimate.tasksCreatedAt
              ? "Regenerate tasks"
              : hasQuoteTasks
                ? "Update tasks from this quote"
                : "Create tasks from quote"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

const inputClass =
  "w-full rounded-[12px] border border-line bg-surface px-3 py-[10px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

export default async function ProjectDetailPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const { org } = await requireSession();
  const project = await getProject(id, org.id);
  if (!project) notFound();
  const due = describeDue(project.dueDate, project.status);

  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const yearAhead = new Date();
  yearAhead.setFullYear(yearAhead.getFullYear() + 1);

  const [team, projectTypes, photos, estimates, schedule, tasks, gmailConnectors, letterhead, allFiles, invoices] = await Promise.all([
    listTeam(org.id),
    listProjectTypes(org.id),
    listProjectPhotos(project.id),
    listEstimates(project.id),
    listSchedule(org.id, { from: yearAgo, to: yearAhead }, { projectId: project.id }),
    listTasks(org.id, { projectId: project.id, includeDone: true }),
    listGmailConnectors(org.id),
    getLetterhead(org.id),
    listAllProjectFiles(project.id),
    listProjectInvoices(project.id, org.id),
  ]);
  // Places for the schedule map: look up any entries still missing coordinates after the response.
  if (schedule.some((e) => e.lat === null && (e.location || e.projectAddress))) {
    after(() => locateScheduleEntries(org.id, schedule));
  }
  const invoiceTotal = invoices.reduce((sum, inv) => sum + inv.amount, 0);

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
          {due ? (
            <span
              className={`flex items-center gap-[5px] text-[12px] font-medium ${due.overdue ? "text-bad-fg" : "text-body-soft"}`}
            >
              <Icon name="calendar" size={13} />
              {due.label}
            </span>
          ) : null}
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

        {/* Keyed by the saved values so the project type <select> doesn't snap back after saving (see AutoSubmitSelect). */}
        <form
          key={[project.title, project.projectTypeId, project.address, project.notes, project.dueDate].join("|")}
          action={saveProject}
          className="grid grid-cols-1 gap-[10px] lg:grid-cols-2"
        >
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
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11px] text-muted">Project site address</span>
            <input name="address" defaultValue={project.address} className={inputClass} />
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11px] text-muted">Due date</span>
            <input name="dueDate" type="date" defaultValue={project.dueDate ?? ""} className={inputClass} />
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
            <div className="ml-auto">
              <DeleteProjectDialog
                projectId={project.id}
                projectTitle={project.title}
                counts={[
                  { label: photos.length === 1 ? "photo" : "photos", count: photos.length },
                  { label: allFiles.length === 1 ? "file" : "files", count: allFiles.length },
                  { label: estimates.length === 1 ? "estimate" : "estimates", count: estimates.length },
                  { label: schedule.length === 1 ? "schedule entry" : "schedule entries", count: schedule.length },
                  { label: tasks.length === 1 ? "task" : "tasks", count: tasks.length },
                ]}
              />
            </div>
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
          <UploadForm endpoint={`/api/projects/${project.id}/photos`} accept="image/*" />
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
              <EditableEstimate
                projectId={project.id}
                estimateId={estimate.id}
                isDraft={estimate.status === "draft"}
                summary={estimate.summary}
                lines={estimate.lineItems.map((li) => ({
                  description: li.description,
                  quantity: li.quantity,
                  unitPrice: li.unitPrice,
                  kind: li.kind,
                }))}
              >
                <p className="m-0 text-[12px] leading-[1.5] text-body-soft">{estimate.summary}</p>
                <ul className="m-0 flex flex-col gap-[2px] pl-[18px] text-[11.5px] text-muted">
                  {estimate.lineItems.map((li) => (
                    <li key={li.id}>
                      {li.description} — {li.quantity} × {money(li.unitPrice)}
                    </li>
                  ))}
                </ul>
              </EditableEstimate>
              {/* Drafts get "Review & send"; a sent estimate can go out again (same version) — "Revise" makes a new one. */}
              <div className="flex flex-wrap items-center gap-[10px]">
                <SendEstimateDialog
                  resend={estimate.status !== "draft"}
                  projectId={project.id}
                  projectTitle={project.title}
                  estimateId={estimate.id}
                  estimate={{
                    summary: estimate.summary,
                    subtotal: estimate.subtotal,
                    tax: estimate.tax,
                    total: estimate.total,
                    lineItems: estimate.lineItems.map((li) => ({
                      description: li.description,
                      quantity: li.quantity,
                      unitPrice: li.unitPrice,
                      kind: li.kind,
                    })),
                  }}
                  customerName={project.customerName}
                  customerEmail={project.customerEmail}
                  connectors={sendableConnectors}
                  letterhead={letterhead}
                  files={allFiles.map((f) => ({ id: f.id, name: f.fileName, sizeBytes: f.sizeBytes }))}
                  photos={photos.map((p, i) => ({
                    id: p.id,
                    name: `photo-${i + 1}`,
                    sizeBytes: p.sizeBytes,
                    url: `/api/projects/${project.id}/photos/${p.id}`,
                  }))}
                />
                {estimate.sentAt ? (
                  <span className="text-[11px] text-faint">Sent {relativeTime(estimate.sentAt)}</span>
                ) : null}
              </div>
              <EstimateOutcome
                projectId={project.id}
                estimate={estimate}
                hasQuoteTasks={tasks.some((t) => t.estimateId !== null)}
              />
            </div>
          ))
        )}
      </TableCard>

      {/* Scheduling: booked time on site — shows on the Schedule page and in the morning briefing. */}
      <TableCard>
        <TableHeader>
          <TableTitle>Schedule</TableTitle>
          <span className="ml-auto flex items-center gap-[12px]">
            <AddToScheduleDialog compact projectId={project.id} members={team} redirectPath={`/projects/${project.id}`} />
            <Link href="/schedule" className="text-[11.5px] font-medium underline">
              All scheduled
            </Link>
          </span>
        </TableHeader>
        <p className="m-0 border-t border-line-soft px-[18px] py-[10px] text-[12px] leading-[1.5] text-muted">
          The days you (or your crew) will be working on this job. They show on the Scheduled page and in the morning
          briefing. For to-dos and reminders, use Tasks below.
        </p>
        <ScheduleViews
          storageKey="clandar.project-schedule-view"
          entries={schedule}
          projectId={project.id}
          members={team}
          redirectPath={`/projects/${project.id}`}
          emptyLabel="Not scheduled yet."
        />
      </TableCard>

      {/* Tasks */}
      <div id="tasks" className="scroll-mt-4" />
      <TableCard>
        <TableHeader>
          <TableTitle>Tasks</TableTitle>
          <span className="ml-auto">
            <NewTaskDialog compact projectId={project.id} redirectPath={`/projects/${project.id}`} members={team} />
          </span>
        </TableHeader>
        <TaskList tasks={tasks} redirectPath={`/projects/${project.id}`} emptyLabel="No tasks yet." />
      </TableCard>

      {/* Spend: invoices and receipts linked to this project (from the invoice page, email, or a parsed file). */}
      <TableCard>
        <TableHeader>
          <TableTitle>Invoices &amp; receipts</TableTitle>
          {invoices.length > 0 ? (
            <span className="ml-auto text-[12px] text-muted">
              {invoices.length} · total <span className="font-mono font-semibold text-ink">{money(invoiceTotal)}</span>
            </span>
          ) : null}
        </TableHeader>
        {invoices.length === 0 ? (
          <EmptyRow>
            None linked yet — link one from its invoice page, record one from an email with {org.assistantName}, or upload a file as
            an Invoice/Receipt below.
          </EmptyRow>
        ) : (
          invoices.map((inv) => (
            <Link
              key={inv.id}
              href={`/invoices/${inv.vendorSlug}?id=${inv.id}`}
              className="flex min-h-[54px] min-w-0 flex-wrap items-center gap-x-3 gap-y-[4px] border-t border-line-soft px-[18px] py-[10px] hover:bg-[#fafbf9]"
            >
              <Icon name="doc" size={16} className="shrink-0 text-body-soft" />
              <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
                <span className="truncate text-[13px] font-semibold">{inv.vendor}</span>
                <span className="truncate text-[11.5px] text-muted">
                  {inv.category} · {shortDate(inv.date)}
                  {inv.dueDate ? ` · due ${shortDate(inv.dueDate)}` : ""}
                </span>
              </div>
              <Pill tone={statusTone(inv.status)}>{statusLabel(inv.status)}</Pill>
              <span className="w-[96px] shrink-0 text-right font-mono text-[12.5px] font-semibold">{money(inv.amount)}</span>
            </Link>
          ))
        )}
      </TableCard>

      {/* Project records: files */}
      <FilesSection projectId={project.id} params={query} />
    </PageBody>
  );
}
