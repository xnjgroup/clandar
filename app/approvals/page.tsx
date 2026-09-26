"use client";

import { useState } from "react";
import { TabList } from "@/components/tabs";
import { CategoryTile, PageBody, TableCard } from "@/components/ui";
import { APPROVAL_TABS, APPROVALS, type ApprovalTab } from "@/lib/data";

export default function ApprovalsPage() {
  const [tab, setTab] = useState<ApprovalTab>("Pending");
  const rows = APPROVALS[tab];

  return (
    <PageBody>
      <TabList options={APPROVAL_TABS} value={tab} onChange={setTab} label="Approval state" />

      <TableCard>
        {rows.map((row) => {
          const flags = row.flags ?? 0;
          return (
            <div
              key={row.vendor}
              className="flex min-w-0 flex-wrap items-center gap-3 border-t border-line-soft px-[18px] py-[13px]"
            >
              <CategoryTile category={row.category} size={32} iconSize={15} radius={10} />
              <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
                <span className="truncate text-[13px] font-semibold">{row.vendor}</span>
                <span className="text-[11px] text-muted">
                  {row.submitter} · {row.date}
                </span>
              </div>
              <span className="shrink-0 font-mono text-[12.5px] font-medium">{row.amount}</span>

              {flags > 0 ? (
                <span className="ml-2 shrink-0 rounded-full bg-bad-bg px-2 py-[3px] text-[10.5px] font-medium whitespace-nowrap text-bad-fg">
                  {flags} flag{flags === 1 ? "" : "s"}
                </span>
              ) : null}

              {tab === "Pending" ? (
                <div className="ml-2 flex shrink-0 items-center gap-[7px]">
                  <button
                    type="button"
                    disabled={flags > 0}
                    title={flags > 0 ? "Clear all flags before approving" : undefined}
                    className="rounded-full bg-lime px-3 py-[6px] text-[11.5px] font-semibold text-ink enabled:cursor-pointer disabled:cursor-not-allowed disabled:bg-idle-bg disabled:text-faint"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="cursor-pointer rounded-full border border-line px-3 py-[6px] text-[11.5px] font-medium"
                  >
                    Reject
                  </button>
                </div>
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
          );
        })}
      </TableCard>
    </PageBody>
  );
}
