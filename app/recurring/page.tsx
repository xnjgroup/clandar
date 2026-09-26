import { CardGrid, CategoryTile, PageBody, StatCard, StatRow } from "@/components/ui";
import { RECURRING_CARDS, RECURRING_STATS } from "@/lib/data";

export default function RecurringPage() {
  return (
    <PageBody>
      <StatRow>
        {RECURRING_STATS.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </StatRow>

      <CardGrid>
        {RECURRING_CARDS.map((r) => (
          <article
            key={r.name}
            className="flex min-w-0 flex-col gap-[11px] rounded-[20px] border border-line bg-surface p-4"
          >
            <div className="flex items-center gap-[11px]">
              <CategoryTile category={r.category} size={36} iconSize={17} radius={12} />
              <h2 className="m-0 min-w-0 flex-1 truncate text-[14.5px] font-bold tracking-[-0.015em]">
                {r.name}
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
              <span className="text-[22px] font-bold tracking-[-0.03em]">{r.amount}</span>
              <span className="text-[11.5px] text-muted">/ {r.cadence}</span>
            </div>
            <div className="flex items-center gap-[9px] border-t border-line-soft pt-[10px] text-[11.5px] text-muted">
              <span>Next {r.nextDue}</span>
              <span className="ml-auto">{r.category}</span>
            </div>
          </article>
        ))}
      </CardGrid>
    </PageBody>
  );
}
