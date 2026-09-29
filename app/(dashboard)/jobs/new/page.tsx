import { Card, CardTitle, PageBody } from "@/components/ui";
import { firstParam } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { listCustomers } from "@/lib/customers";
import { NewJobForm } from "../new-job-form";

export default async function NewJobPage({ searchParams }: PageProps<"/jobs/new">) {
  const { org } = await requireSession();
  const customerId = firstParam((await searchParams).customer);
  const customers = await listCustomers(org.id);

  return (
    <PageBody>
      <Card className="flex flex-col gap-[13px]">
        <CardTitle>New job</CardTitle>
        <NewJobForm
          customers={customers.map((c) => ({ id: c.id, name: c.name }))}
          defaultCustomerId={customerId || undefined}
        />
      </Card>
    </PageBody>
  );
}
