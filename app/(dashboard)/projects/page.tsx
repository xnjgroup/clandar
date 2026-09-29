import Link from "next/link";
import { Icon, iconName } from "@/components/icons";
import { EmptyRow, IconTile, PageBody, Pill, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { count, firstParam, hrefWith, relativeTime, type Tone } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { PROJECT_STATUSES, projectCountsByStatus, listProjects, type ProjectStatus } from "@/lib/projects";

const STATUS_TONE: Record<ProjectStatus, Tone> = {
  lead: "idle",
  quoted: "warn",
  scheduled: "warn",
  in_progress: "ok",
  completed: "ok",
  cancelled: "bad",
};

const PATH = "/projects";

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const params = await searchParams;
  const statusFilter = firstParam(params.status) as ProjectStatus | "";
  const { org } = await requireSession();

  const [projects, counts] = await Promise.all([
    listProjects(org.id, statusFilter ? { status: statusFilter } : {}),
    projectCountsByStatus(org.id),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <PageBody>
      <div className="flex flex-wrap items-center gap-[9px]">
        <div className="flex min-w-0 flex-1 flex-wrap gap-[7px]">
          <Link
            href={hrefWith(PATH, params, { status: null })}
            className={`rounded-full px-[14px] py-[8px] text-[12.5px] font-medium ${
              !statusFilter ? "bg-ink text-bg" : "border border-line bg-surface text-body"
            }`}
          >
            All ({count(total)})
          </Link>
          {PROJECT_STATUSES.map((s) => (
            <Link
              key={s.id}
              href={hrefWith(PATH, params, { status: s.id })}
              className={`rounded-full px-[14px] py-[8px] text-[12.5px] font-medium ${
                statusFilter === s.id ? "bg-ink text-bg" : "border border-line bg-surface text-body"
              }`}
            >
              {s.label} ({count(counts[s.id])})
            </Link>
          ))}
        </div>
        <Link
          href="/projects/types"
          className="flex shrink-0 items-center gap-[7px] rounded-full border border-line bg-surface px-4 py-[9px] text-[12.5px] font-medium text-body"
        >
          <Icon name="settings" size={15} />
          Project types
        </Link>
        <Link
          href="/projects/new"
          className="flex shrink-0 items-center gap-[7px] rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg"
        >
          <Icon name="briefcase" size={15} />
          New project
        </Link>
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
              className="flex min-h-[64px] min-w-0 flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[13px] hover:bg-[#fafbf9]"
            >
              <IconTile icon={iconName(project.projectTypeIcon)} bg="#f2f4ef" fg="#4c4f47" />
              <div className="flex min-w-0 flex-1 flex-col leading-[1.4]">
                <span className="truncate text-[13.5px] font-semibold">{project.title}</span>
                <span className="truncate text-[11.5px] text-muted">
                  {project.customerName}
                  {project.projectTypeName ? ` · ${project.projectTypeName}` : ""}
                </span>
                {project.address ? <span className="truncate text-[11px] text-faint">{project.address}</span> : null}
              </div>
              {project.assignedName ? (
                <span className="hidden shrink-0 items-center gap-[6px] rounded-full border border-line px-[10px] py-[5px] text-[11px] text-body-soft sm:flex">
                  <Icon name="user" size={12} />
                  {project.assignedName}
                </span>
              ) : null}
              <Pill tone={STATUS_TONE[project.status]}>
                {PROJECT_STATUSES.find((s) => s.id === project.status)?.label ?? project.status}
              </Pill>
              <span className="ml-2 hidden shrink-0 font-mono text-[11px] text-faint sm:inline">
                {relativeTime(project.updatedAt)}
              </span>
            </Link>
          ))
        )}
      </TableCard>
    </PageBody>
  );
}
