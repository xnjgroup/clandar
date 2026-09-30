import Link from "next/link";
import { Icon, iconName } from "@/components/icons";
import { HeaderActions } from "@/components/header-actions";
import { EmptyRow, headerIconClass, IconTile, PageBody, Pill, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { count, firstParam, hrefWith, money, relativeTime, type Tone } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { listCustomers } from "@/lib/customers";
import { listProjectTypes } from "@/lib/project-types";
import {
  PROJECT_STATUSES,
  describeDue,
  projectCountsByStatus,
  listProjects,
  type Project,
  type ProjectStatus,
} from "@/lib/projects";
import { NewProjectDialog } from "./new-project-form";

const STATUS_TONE: Record<ProjectStatus, Tone> = {
  lead: "idle",
  quoted: "warn",
  scheduled: "warn",
  in_progress: "ok",
  completed: "ok",
  cancelled: "bad",
};

const PATH = "/projects";

const ESTIMATE_TONE: Record<"draft" | "sent" | "accepted" | "declined", string> = {
  draft: "text-faint",
  sent: "text-warn-fg",
  accepted: "text-ok-fg",
  declined: "text-bad-fg",
};

/** The latest quote's total and where it stands — an empty slot when there's no quote, so columns line up. */
function EstimateAmount({ estimate }: { estimate: Project["latestEstimate"] }) {
  return (
    <span className={`shrink-0 flex-col leading-[1.3] sm:flex sm:w-[104px] sm:items-end ${estimate ? "flex items-start" : "hidden"}`} title={estimate ? `Latest estimate · ${estimate.status}` : undefined}>
      {estimate ? (
        <>
          <span className="font-mono text-[12.5px] font-semibold">{money(estimate.total)}</span>
          <span className={`text-[10.5px] font-medium ${ESTIMATE_TONE[estimate.status]}`}>
            Quote · {estimate.status}
          </span>
        </>
      ) : null}
    </span>
  );
}

/** What's been spent on the project — the sum of its linked invoices/receipts; an empty slot when there are none. */
function SpentAmount({ total, count }: { total: number; count: number }) {
  return (
    <span
      className={`shrink-0 flex-col leading-[1.3] sm:flex sm:w-[96px] sm:items-end ${count ? "flex items-start" : "hidden"}`}
      title={count ? `${count} invoice${count === 1 ? "" : "s"} linked` : undefined}
    >
      {count ? (
        <>
          <span className="font-mono text-[12.5px] font-semibold">{money(total)}</span>
          <span className="text-[10.5px] font-medium text-muted">
            Spent · {count} invoice{count === 1 ? "" : "s"}
          </span>
        </>
      ) : null}
    </span>
  );
}

function DueLine({ dueDate, status }: { dueDate: string | null; status: ProjectStatus }) {
  const due = describeDue(dueDate, status);
  if (!due) return null;
  return (
    <span className={`truncate text-[11px] ${due.overdue ? "font-medium text-bad-fg" : "text-faint"}`}>{due.label}</span>
  );
}

/** Share of the project's tasks marked done — a bar plus the percentage; "No tasks" when there's nothing to measure. */
function TaskProgress({ done, total }: { done: number; total: number }) {
  if (total === 0) {
    return <span className="min-w-0 flex-1 text-[11px] text-faint sm:w-[120px] sm:flex-none sm:text-right">No tasks</span>;
  }
  const pct = Math.round((done / total) * 100);
  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-[8px] sm:w-[120px] sm:flex-none"
      title={`${done} of ${total} task${total === 1 ? "" : "s"} done`}
    >
      <span className="h-[6px] flex-1 overflow-hidden rounded-full bg-line-soft">
        <span
          className={`block h-full rounded-full ${pct === 100 ? "bg-ok-fg" : "bg-ink"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-[34px] text-right font-mono text-[11px] font-semibold">{pct}%</span>
    </span>
  );
}

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const params = await searchParams;
  const statusFilter = firstParam(params.status) as ProjectStatus | "";
  const { org } = await requireSession();

  const [projects, counts, customers, projectTypes] = await Promise.all([
    listProjects(org.id, statusFilter ? { status: statusFilter } : {}),
    projectCountsByStatus(org.id),
    listCustomers(org.id),
    listProjectTypes(org.id),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <PageBody>
      <HeaderActions>
        <Link href="/projects/types" aria-label="Project types" title="Project types" className={headerIconClass}>
          <Icon name="settings" size={17} />
        </Link>
        <NewProjectDialog
          customers={customers.map((c) => ({ id: c.id, name: c.name }))}
          projectTypes={projectTypes.map((t) => ({ id: t.id, name: t.name }))}
        />
      </HeaderActions>

      {/* Status filters: one sideways-scrolling row on phones, wrapping on desktop. */}
      <div className="-mx-[14px] flex min-w-0 gap-[7px] overflow-x-auto px-[14px] pb-[2px] [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
        <Link
          href={hrefWith(PATH, params, { status: null })}
          className={`shrink-0 whitespace-nowrap rounded-full px-[14px] py-[8px] text-[12.5px] font-medium ${
            !statusFilter ? "bg-ink text-bg" : "border border-line bg-surface text-body"
          }`}
        >
          All ({count(total)})
        </Link>
        {PROJECT_STATUSES.map((s) => (
          <Link
            key={s.id}
            href={hrefWith(PATH, params, { status: s.id })}
            className={`shrink-0 whitespace-nowrap rounded-full px-[14px] py-[8px] text-[12.5px] font-medium ${
              statusFilter === s.id ? "bg-ink text-bg" : "border border-line bg-surface text-body"
            }`}
          >
            {s.label} ({count(counts[s.id])})
          </Link>
        ))}
      </div>

      <TableCard>
        <TableHeader>
          <TableTitle>
            {statusFilter ? PROJECT_STATUSES.find((s) => s.id === statusFilter)?.label : "All projects"}
          </TableTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {count(projects.length)} project{projects.length === 1 ? "" : "s"}
          </span>
        </TableHeader>

        {projects.length === 0 ? (
          <EmptyRow>
            {statusFilter
              ? "Nothing in this status yet."
              : "No projects yet — add a customer, then create their first project."}
          </EmptyRow>
        ) : (
          projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="flex min-h-[64px] min-w-0 flex-wrap items-center gap-x-3 gap-y-[8px] border-t border-line-soft px-[18px] py-[13px] hover:bg-[#fafbf9]"
            >
              <IconTile icon={iconName(project.projectTypeIcon)} bg="#f2f4ef" fg="#4c4f47" />
              {/* Phones: name/customer fill the first line; quote, progress and status wrap onto a second line under it. */}
              <div className="flex min-w-0 flex-1 basis-[calc(100%-46px)] flex-col leading-[1.4] sm:basis-0">
                <span className="truncate text-[13.5px] font-semibold">{project.title}</span>
                <span className="truncate text-[11.5px] text-muted">
                  {project.customerName}
                  {project.projectTypeName ? ` · ${project.projectTypeName}` : ""}
                </span>
                {project.address ? <span className="truncate text-[11px] text-faint">{project.address}</span> : null}
                <DueLine dueDate={project.dueDate} status={project.status} />
              </div>
              {project.assignedName ? (
                <span className="hidden shrink-0 items-center gap-[6px] rounded-full border border-line px-[10px] py-[5px] text-[11px] text-body-soft sm:flex">
                  <Icon name="user" size={12} />
                  {project.assignedName}
                </span>
              ) : null}
              <div className="flex w-full min-w-0 items-center gap-3 pl-[46px] sm:w-auto sm:pl-0">
                <EstimateAmount estimate={project.latestEstimate} />
                <SpentAmount total={project.invoicesTotal} count={project.invoiceCount} />
                <TaskProgress done={project.tasksDone} total={project.taskCount} />
                {/* Fixed-width slots for the status and the time, so the quote / spent / progress columns
                    line up from row to row whatever the status label ("Lead" vs "In progress"). */}
                <span className="flex shrink-0 sm:w-[82px] sm:justify-center">
                  <Pill tone={STATUS_TONE[project.status]}>
                    {PROJECT_STATUSES.find((s) => s.id === project.status)?.label ?? project.status}
                  </Pill>
                </span>
                <span className="hidden w-[84px] shrink-0 truncate text-right font-mono text-[11px] text-faint sm:inline">
                  {relativeTime(project.updatedAt)}
                </span>
              </div>
            </Link>
          ))
        )}
      </TableCard>
    </PageBody>
  );
}
