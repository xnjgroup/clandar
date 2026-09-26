import { Icon } from "@/components/icons";
import { Card, CardGrid, CardTitle, PageBody } from "@/components/ui";
import { ALERT_LOG, ALERT_RULES, BUDGETS, money0 } from "@/lib/data";

export default function BudgetsPage() {
  return (
    <PageBody>
      <CardGrid>
        {BUDGETS.map((b) => {
          const pct = Math.min(100, Math.round((b.used / b.cap) * 100));
          const over = b.used > b.cap;
          const near = !over && pct > 85;
          return (
            <article
              key={b.category}
              className="flex min-w-0 flex-col gap-[10px] rounded-[20px] border border-line bg-surface p-4"
            >
              <div className="flex items-baseline gap-[9px]">
                <h2 className="m-0 min-w-0 flex-1 truncate text-[14px] font-bold tracking-[-0.015em]">
                  {b.category}
                </h2>
                <span className="shrink-0 font-mono text-[11.5px] whitespace-nowrap text-muted">
                  {money0(b.used)} / {money0(b.cap)}
                </span>
              </div>

              <div
                className="h-2 overflow-hidden rounded-[5px] bg-line-soft"
                role="meter"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${b.category} budget used`}
              >
                <div
                  className={`h-full rounded-[5px] ${
                    over ? "bg-meter-bad" : near ? "bg-meter-warn" : "bg-meter-ok"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <span
                className={`text-[11px] ${
                  over ? "text-bad-fg" : near ? "text-warn-fg" : "text-muted"
                }`}
              >
                {over
                  ? "Over budget — review before approving more"
                  : near
                    ? "Approaching the cap"
                    : "On track"}
              </span>
            </article>
          );
        })}
      </CardGrid>

      <Card className="flex flex-col gap-[13px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <CardTitle>Usage alerts</CardTitle>
          <span className="text-[11.5px] text-muted">
            Notify when spend crosses a threshold, by category or vendor
          </span>
          <button
            type="button"
            className="ml-auto shrink-0 cursor-pointer rounded-full bg-ink px-[15px] py-2 text-[12.5px] font-semibold text-bg"
          >
            Add rule
          </button>
        </div>

        {ALERT_RULES.map((rule) => (
          <div
            key={rule.label}
            className="flex min-w-0 flex-wrap items-center gap-3 rounded-[14px] border border-line-soft px-[14px] py-3"
          >
            <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
              <span className="text-[13px] font-semibold">{rule.label}</span>
              <span className="text-[11px] text-muted">Triggers at {rule.threshold} of cap</span>
            </div>
            <div className="flex shrink-0 gap-[6px]">
              {rule.channels.map((channel) => (
                <span
                  key={channel}
                  className="rounded-full bg-idle-bg px-2 py-[3px] font-mono text-[10px] whitespace-nowrap text-body-soft"
                >
                  {channel}
                </span>
              ))}
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-[3px] text-[10.5px] font-medium ${
                rule.tone === "ok" ? "bg-ok-bg text-ok-fg" : "bg-idle-bg text-idle-fg"
              }`}
            >
              {rule.state}
            </span>
          </div>
        ))}

        <hr className="my-[2px] h-px border-0 bg-line-soft" />
        <span className="font-mono text-[10px] tracking-[0.1em] text-faint uppercase">
          Recently triggered
        </span>

        {ALERT_LOG.map((entry) => (
          <div key={entry.text} className="flex min-w-0 items-baseline gap-[10px]">
            <Icon name={entry.icon} size={14} className="mt-[2px] shrink-0 text-faint" />
            <span className="min-w-0 flex-1 text-[12.5px] leading-[1.5]">{entry.text}</span>
            <span className="shrink-0 font-mono text-[10.5px] text-faint">{entry.time}</span>
          </div>
        ))}
      </Card>
    </PageBody>
  );
}
