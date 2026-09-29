import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { Card, CardTitle, EmptyRow, IconTile, PageBody, Pill, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { relativeTime, type Tone } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { getCustomer } from "@/lib/customers";
import { JOB_STATUSES, listJobs, tradeLabel, type JobStatus } from "@/lib/jobs";
import { removeCustomer, saveCustomer } from "../actions";

const STATUS_TONE: Record<JobStatus, Tone> = {
  lead: "idle",
  quoted: "warn",
  scheduled: "warn",
  in_progress: "ok",
  completed: "ok",
  cancelled: "bad",
};

const inputClass =
  "w-full rounded-[12px] border border-line bg-surface px-3 py-[10px] text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-[#9aa78a]";

export default async function CustomerDetailPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  const { org } = await requireSession();
  const customer = await getCustomer(id, org.id);
  if (!customer) notFound();

  const jobs = await listJobs(org.id, { customerId: id });

  return (
    <PageBody>
      <Card className="flex flex-col gap-[13px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <CardTitle>{customer.name}</CardTitle>
          <Link href="/customers" className="ml-auto text-[11.5px] font-medium underline">
            All customers
          </Link>
        </div>

        <form action={saveCustomer} className="grid grid-cols-1 gap-[10px] lg:grid-cols-2">
          <input type="hidden" name="id" value={customer.id} />
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11px] text-muted">Name</span>
            <input name="name" defaultValue={customer.name} required className={inputClass} />
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11px] text-muted">Phone</span>
            <input name="phone" type="tel" defaultValue={customer.phone ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11px] text-muted">Email</span>
            <input name="email" type="email" defaultValue={customer.email ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className="text-[11px] text-muted">Address</span>
            <input name="address" defaultValue={customer.address ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-[5px] lg:col-span-2">
            <span className="text-[11px] text-muted">Notes</span>
            <textarea name="notes" rows={2} defaultValue={customer.notes} className={inputClass} />
          </label>
          <div className="flex items-center gap-[10px] lg:col-span-2">
            <button
              type="submit"
              className="cursor-pointer rounded-full bg-ink px-4 py-[9px] text-[12.5px] font-semibold text-bg"
            >
              Save
            </button>
            <span className="text-[11px] text-faint">Added {relativeTime(customer.createdAt)}</span>
          </div>
        </form>

        <form action={removeCustomer} className="border-t border-line-soft pt-[12px]">
          <input type="hidden" name="id" value={customer.id} />
          <button
            type="submit"
            disabled={jobs.length > 0}
            title={jobs.length > 0 ? "Remove this customer's jobs first" : undefined}
            className="cursor-pointer text-[11.5px] font-medium text-bad-fg underline enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete customer
          </button>
        </form>
      </Card>

      <TableCard>
        <TableHeader>
          <TableTitle>Jobs</TableTitle>
          <Link
            href={`/jobs/new?customer=${customer.id}`}
            className="ml-auto flex shrink-0 items-center gap-[6px] rounded-full bg-ink px-[14px] py-[7px] text-[12px] font-semibold text-bg"
          >
            <Icon name="briefcase" size={14} />
            New job
          </Link>
        </TableHeader>

        {jobs.length === 0 ? (
          <EmptyRow>No jobs for this customer yet.</EmptyRow>
        ) : (
          jobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="flex min-h-[60px] min-w-0 items-center gap-3 border-t border-line-soft px-[18px] py-[12px] hover:bg-[#fafbf9]"
            >
              <IconTile icon="briefcase" bg="#f2f4ef" fg="#4c4f47" />
              <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
                <span className="truncate text-[13px] font-semibold">{job.title}</span>
                <span className="truncate text-[11px] text-muted">{tradeLabel(job.trade)}</span>
              </div>
              <Pill tone={STATUS_TONE[job.status]}>
                {JOB_STATUSES.find((s) => s.id === job.status)?.label ?? job.status}
              </Pill>
            </Link>
          ))
        )}
      </TableCard>
    </PageBody>
  );
}
