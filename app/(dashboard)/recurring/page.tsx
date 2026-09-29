import { CardGrid, CategoryTile, PageBody, StatCard, StatRow } from "@/components/ui";
import { count, money, money0, shortDate } from "@/lib/data";
import { recurringCharges, recurringStats } from "@/lib/queries";

export default async function RecurringPage() {
  const [stats, charges] = await Promise.all([recurringStats(), recurringCharges()]);

  const cards = [
    {
      label: "Active subscriptions",
      value: count(stats.subscriptions),
      sub: `${money0(stats.monthlyTotal)} / month`,
    },
    {
      label: "Due in 7 days",
      value: count(stats.dueSoon),
      sub: `${money0(stats.dueSoonTotal)} combined`,
    },
    {
      label: "Price increases this year",
      value: count(stats.increases),
      sub:
        stats.increases > 0
          ? `avg +${stats.avgIncreasePct.toFixed(1)}%`
          : "no increases detected",
    },
  ];

  return (
    <PageBody>
      <StatRow>
        {cards.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </StatRow>

      {charges.length === 0 ? (
        <span className="text-[12.5px] text-muted">No recurring charges recorded yet.</span>
      ) : null}

      <CardGrid>
        {charges.map((r) => (
          <article
            key={r.vendor}
            className="flex min-w-0 flex-col gap-[11px] rounded-[20px] border border-line bg-surface p-4"
          >
            <div className="flex items-center gap-[11px]">
              <CategoryTile category={r.category} size={36} iconSize={17} radius={12} />
              <h2 className="m-0 min-w-0 flex-1 truncate text-[14.5px] font-bold tracking-[-0.015em]">
                {r.vendor}
              </h2>
              <span
                className={`shrink-0 font-mono text-[10.5px] ${
                  r.rising ? "text-warn-fg" : "text-muted"
                }`}
              >
                {r.rising ? "↑ rising" : "→ flat"}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[22px] font-bold tracking-[-0.03em]">{money(r.amount)}</span>
              <span className="text-[11.5px] text-muted">/ {r.cadence}</span>
            </div>
            <div className="flex items-center gap-[9px] border-t border-line-soft pt-[10px] text-[11.5px] text-muted">
              <span>Next {shortDate(r.nextDue)}</span>
              <span className="ml-auto">{r.category}</span>
            </div>
          </article>
        ))}
      </CardGrid>
    </PageBody>
  );
}
