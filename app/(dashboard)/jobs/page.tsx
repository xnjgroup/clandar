import Link from "next/link";
import { Icon } from "@/components/icons";
import { EmptyRow, IconTile, PageBody, Pill, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { count, firstParam, hrefWith, relativeTime, type Tone } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { JOB_STATUSES, jobCountsByStatus, listJobs, tradeLabel, type JobStatus } from "@/lib/jobs";

const STATUS_TONE: Record<JobStatus, Tone> = {
  lead: "idle",
  quoted: "warn",
  scheduled: "warn",
  in_progress: "ok",
  completed: "ok",
  cancelled: "bad",
};

const PATH = "/jobs";

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const params = await searchParams;
  const statusFilter = firstParam(params.status) as JobStatus | "";
  const { org } = await requireSession();

  const [jobs, counts] = await Promise.all([
    listJobs(org.id, statusFilter ? { status: statusFilter } : {}),
    jobCountsByStatus(org.id),
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
          {JOB_STATUSES.map((s) => (
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
          href="/jobs/new"
          className="flex shrink-0 items-center gap-[7px] rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg"
        >
          <Icon name="briefcase" size={15} />
          New job
        </Link>
      </div>

      <TableCard>
        <TableHeader>
          <TableTitle>{statusFilter ? JOB_STATUSES.find((s) => s.id === statusFilter)?.label : "All jobs"}</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">{count(jobs.length)} job{jobs.length === 1 ? "" : "s"}</span>
        </TableHeader>

        {jobs.length === 0 ? (
          <EmptyRow>
            {statusFilter ? "Nothing in this status yet." : "No jobs yet — add a customer, then create their first job."}
          </EmptyRow>
        ) : (
          jobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="flex min-h-[64px] min-w-0 flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[13px] hover:bg-[#fafbf9]"
            >
              <IconTile icon="briefcase" bg="#f2f4ef" fg="#4c4f47" />
              <div className="flex min-w-0 flex-1 flex-col leading-[1.4]">
                <span className="truncate text-[13.5px] font-semibold">{job.title}</span>
                <span className="truncate text-[11.5px] text-muted">
                  {job.customerName} · {tradeLabel(job.trade)}
                </span>
                {job.address ? <span className="truncate text-[11px] text-faint">{job.address}</span> : null}
              </div>
              {job.assignedName ? (
                <span className="hidden shrink-0 items-center gap-[6px] rounded-full border border-line px-[10px] py-[5px] text-[11px] text-body-soft sm:flex">
                  <Icon name="user" size={12} />
                  {job.assignedName}
                </span>
              ) : null}
              <Pill tone={STATUS_TONE[job.status]}>
                {JOB_STATUSES.find((s) => s.id === job.status)?.label ?? job.status}
              </Pill>
              <span className="ml-2 hidden shrink-0 font-mono text-[11px] text-faint sm:inline">
                {relativeTime(job.updatedAt)}
              </span>
            </Link>
          ))
        )}
      </TableCard>
    </PageBody>
  );
}
