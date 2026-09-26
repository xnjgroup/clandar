import { Icon } from "@/components/icons";
import {
  PageBody,
  StatCard,
  StatRow,
  TableCard,
  TableHeader,
  TableTitle,
} from "@/components/ui";
import { FRAUD_FLAGS, FRAUD_STATS } from "@/lib/data";

export default function FraudPage() {
  return (
    <PageBody>
      <StatRow>
        {FRAUD_STATS.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </StatRow>

      <TableCard>
        <TableHeader>
          <TableTitle>Flagged for review</TableTitle>
        </TableHeader>

        {FRAUD_FLAGS.map((f) => {
          const high = f.severity === "high";
          return (
            <div
              key={f.title}
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
                    {high ? "high" : "medium"}
                  </span>
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
                <button
                  type="button"
                  className="cursor-pointer rounded-full bg-ink px-3 py-[6px] text-[11.5px] font-medium text-bg"
                >
                  Investigate
                </button>
              </div>
            </div>
          );
        })}
      </TableCard>
    </PageBody>
  );
}
