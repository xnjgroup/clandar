import Link from "next/link";
import { TabLinks } from "@/components/tabs";
import { CategoryTile, EmptyRow, PageBody, TableCard } from "@/components/ui";
import { firstParam, hrefWith, money, shortDate } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { APPROVAL_TABS, listApprovals, type ApprovalTab } from "@/lib/queries";
import { decideInvoice } from "./actions";

const PATH = "/approvals";

export default async function ApprovalsPage({ searchParams }: PageProps<"/approvals">) {
  const params = await searchParams;
  const requested = firstParam(params.state) as ApprovalTab;
  const tab = APPROVAL_TABS.includes(requested) ? requested : "Pending";
  const { org } = await requireSession();
  const rows = await listApprovals(org.id, tab);

  return (
    <PageBody>
      <TabLinks
        options={APPROVAL_TABS}
        value={tab}
        label="Approval state"
        href={(option) =>
          hrefWith(PATH, params, { state: option === "Pending" ? null : option })
        }
      />

      <TableCard>
        {rows.length === 0 ? <EmptyRow>Nothing in this queue.</EmptyRow> : null}

        {rows.map((row) => (
          <div
            key={row.id}
            className="flex min-w-0 flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[13px]"
          >
            <CategoryTile category={row.category} size={32} iconSize={15} radius={10} />
            <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
              <Link
                href={`/invoices/${row.slug}?id=${row.id}`}
                className="truncate text-[13px] font-semibold hover:underline"
              >
                {row.vendor}
              </Link>
              <span className="text-[11px] text-muted">
                {row.submittedBy} · {shortDate(row.date)}
              </span>
            </div>
            <span className="shrink-0 font-mono text-[12.5px] font-medium">{money(row.amount)}</span>

            {row.flags > 0 ? (
              <span className="ml-2 shrink-0 rounded-full bg-bad-bg px-2 py-[3px] text-[10.5px] font-medium whitespace-nowrap text-bad-fg">
                {row.flags} flag{row.flags === 1 ? "" : "s"}
              </span>
            ) : null}

            {tab === "Pending" ? (
              <form action={decideInvoice} className="ml-2 flex shrink-0 items-center gap-[7px]">
                <input type="hidden" name="id" value={row.id} />
                <button
                  type="submit"
                  name="decision"
                  value="approve"
                  disabled={row.flags > 0}
                  title={row.flags > 0 ? "Clear all flags before approving" : undefined}
                  className="rounded-full bg-lime px-3 py-[6px] text-[11.5px] font-semibold text-ink enabled:cursor-pointer disabled:cursor-not-allowed disabled:bg-idle-bg disabled:text-faint"
                >
                  Approve
                </button>
                <button
                  type="submit"
                  name="decision"
                  value="reject"
                  className="cursor-pointer rounded-full border border-line px-3 py-[6px] text-[11.5px] font-medium"
                >
                  Reject
                </button>
              </form>
            ) : (
              <span
                className={`ml-2 shrink-0 rounded-full px-2 py-[3px] text-[10.5px] font-medium ${
                  tab === "Approved" ? "bg-ok-bg text-ok-fg" : "bg-bad-bg text-bad-fg"
                }`}
              >
                {tab}
              </span>
            )}
          </div>
        ))}
      </TableCard>
    </PageBody>
  );
}
