import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon, iconName } from "@/components/icons";
import { Card, CardTitle, EmptyRow, IconTile, PageBody, Pill, TableCard, TableHeader, TableTitle } from "@/components/ui";
import { relativeTime, type Tone } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { getCustomer } from "@/lib/customers";
import { PROJECT_STATUSES, listProjects, type ProjectStatus } from "@/lib/projects";
import { removeCustomer, removeCustomerProject, saveCustomer } from "../actions";

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

export default async function CustomerDetailPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  const { org } = await requireSession();
  const customer = await getCustomer(id, org.id);
  if (!customer) notFound();

  const projects = await listProjects(org.id, { customerId: id });

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
            disabled={projects.length > 0}
            title={projects.length > 0 ? "Remove this customer's projects first" : undefined}
            className="cursor-pointer text-[11.5px] font-medium text-bad-fg underline enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete customer
          </button>
        </form>
      </Card>

      <TableCard>
        <TableHeader>
          <TableTitle>Projects</TableTitle>
          <Link
            href={`/projects/new?customer=${customer.id}`}
            className="ml-auto flex shrink-0 items-center gap-[6px] rounded-full bg-ink px-[14px] py-[7px] text-[12px] font-semibold text-bg"
          >
            <Icon name="briefcase" size={14} />
            New project
          </Link>
        </TableHeader>

        {projects.length === 0 ? (
          <EmptyRow>No projects for this customer yet.</EmptyRow>
        ) : (
          projects.map((project) => (
            <div
              key={project.id}
              className="flex min-h-[60px] min-w-0 items-center gap-3 border-t border-line-soft px-[18px] py-[12px] hover:bg-[#fafbf9]"
            >
              <Link href={`/projects/${project.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <IconTile icon={iconName(project.projectTypeIcon)} bg="#f2f4ef" fg="#4c4f47" />
                <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
                  <span className="truncate text-[13px] font-semibold">{project.title}</span>
                  {project.projectTypeName ? (
                    <span className="truncate text-[11px] text-muted">{project.projectTypeName}</span>
                  ) : null}
                </div>
              </Link>
              <Pill tone={STATUS_TONE[project.status]}>
                {PROJECT_STATUSES.find((s) => s.id === project.status)?.label ?? project.status}
              </Pill>
              <form action={removeCustomerProject}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="customerId" value={customer.id} />
                <button
                  type="submit"
                  aria-label={`Delete ${project.title}`}
                  className="cursor-pointer text-faint hover:text-bad-fg"
                >
                  <Icon name="close" size={16} />
                </button>
              </form>
            </div>
          ))
        )}
      </TableCard>
    </PageBody>
  );
}
