import Link from "next/link";
import { Icon } from "@/components/icons";
import {
  EmptyRow,
  PageBody,
  StatCard,
  StatRow,
  TableCard,
  TableHeader,
  TableTitle,
} from "@/components/ui";
import { count, money0 } from "@/lib/data";
import { fraudStats, openFraudFlags } from "@/lib/queries";

export default async function FraudPage() {
  const [stats, flags] = await Promise.all([fraudStats(), openFraudFlags()]);

  const cards = [
    {
      label: "Open flags",
      value: count(stats.openCount),
      sub:
        stats.openCount === 0
          ? "nothing under review"
          : `${count(stats.duplicateCount)} duplicate, ${count(stats.openCount - stats.duplicateCount)} other`,
    },
    {
      label: "Exposure at risk",
      value: money0(stats.exposure),
      sub: stats.highCount > 0 ? `${count(stats.highCount)} rated high` : "no high-severity flags",
    },
    {
      label: "Avg time to resolve",
      value: stats.avgResolveDays === null ? "—" : `${stats.avgResolveDays.toFixed(1)} days`,
      sub: "trailing 90 days",
    },
  ];

  return (
    <PageBody>
      <StatRow>
        {cards.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </StatRow>

      <TableCard>
        <TableHeader>
          <TableTitle>Flagged for review</TableTitle>
        </TableHeader>

        {flags.length === 0 ? <EmptyRow>No open anomalies.</EmptyRow> : null}

        {flags.map((f) => {
          const high = f.severity === "high";
          return (
            <div
              key={f.id}
              className="flex min-w-0 flex-wrap items-start gap-3 border-t border-line-soft px-[18px] py-[14px]"
            >
              <span
                className={`flex size-[34px] shrink-0 items-center justify-center rounded-[11px] ${
                  high ? "bg-bad-bg text-bad-fg" : "bg-warn-bg text-warn-fg"
                }`}
              >
                <Icon name="alert" size={16} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <div className="flex flex-wrap items-baseline gap-[9px]">
                  <h2 className="m-0 text-[13px] font-semibold">{f.title}</h2>
                  <span
                    className={`rounded-full px-2 py-[3px] text-[10.5px] font-medium ${
                      high ? "bg-bad-bg text-bad-fg" : "bg-warn-bg text-warn-fg"
                    }`}
                  >
                    {f.severity === "med" ? "medium" : f.severity}
                  </span>
                  {f.exposure > 0 ? (
                    <span className="font-mono text-[10.5px] text-faint">
                      {money0(f.exposure)} at risk
                    </span>
                  ) : null}
                </div>
                <p className="m-0 text-[12px] leading-[1.5] text-muted">{f.note}</p>
              </div>
              <div className="flex shrink-0 gap-[7px]">
                <button
                  type="button"
                  className="cursor-pointer rounded-full border border-line px-3 py-[6px] text-[11.5px] font-medium"
                >
                  Dismiss
                </button>
                {f.invoiceSlug && f.invoiceId ? (
                  <Link
                    href={`/invoices/${f.invoiceSlug}?id=${f.invoiceId}`}
                    className="rounded-full bg-ink px-3 py-[6px] text-[11.5px] font-medium text-bg"
                  >
                    Investigate
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="cursor-pointer rounded-full bg-ink px-3 py-[6px] text-[11.5px] font-medium text-bg"
                  >
                    Investigate
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </TableCard>
    </PageBody>
  );
}
