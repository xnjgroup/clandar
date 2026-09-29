import { Card, CardTitle, PageBody } from "@/components/ui";
import { firstParam } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { listCustomers } from "@/lib/customers";
import { listProjectTypes } from "@/lib/project-types";
import { NewProjectForm } from "../new-project-form";

export default async function NewProjectPage({ searchParams }: PageProps<"/projects/new">) {
  const { org } = await requireSession();
  const customerId = firstParam((await searchParams).customer);
  const [customers, projectTypes] = await Promise.all([
    listCustomers(org.id),
    listProjectTypes(org.id),
  ]);

  return (
    <PageBody>
      <Card className="flex flex-col gap-[13px]">
        <CardTitle>New project</CardTitle>
        <NewProjectForm
          customers={customers.map((c) => ({ id: c.id, name: c.name }))}
          projectTypes={projectTypes.map((t) => ({ id: t.id, name: t.name }))}
          defaultCustomerId={customerId || undefined}
        />
      </Card>
    </PageBody>
  );
}
