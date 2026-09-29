import { VendorTrendChart } from "@/components/charts";
import { Icon } from "@/components/icons";
import { PageBody } from "@/components/ui";
import { latestConversation, vendorTrend } from "@/lib/queries";

export default async function MessagesPage() {
  const [conversation, trend] = await Promise.all([
    latestConversation(),
    vendorTrend({ categories: ["Utilities", "Telecom"], months: 4, limit: 3 }),
  ]);
  const turns = conversation?.turns ?? [];
  const question = turns.find((t) => t.role === "user");
  const answer = turns.find((t) => t.role === "assistant");

  return (
    <PageBody>
      {question ? (
        <p className="m-0 max-w-[700px] self-end rounded-[18px] bg-ink px-[15px] py-[11px] text-[13.5px] leading-[1.55] text-bg">
          {question.body}
        </p>
      ) : null}

      <div className="flex min-w-0 gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-lime">
          <Icon name="bot" size={18} />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {answer && answer.toolCalls.length > 0 ? (
            <div className="overflow-hidden rounded-[18px] border border-line bg-surface">
              {answer.toolCalls.map((step) => (
                <div
                  key={step.tool}
                  className="flex items-center gap-[11px] border-b border-line-soft px-[14px] py-[11px]"
                >
                  <span className="shrink-0 rounded-[6px] bg-ok-bg px-[7px] py-[3px] font-mono text-[10.5px] text-ok-fg">
                    {step.tool}
                  </span>
                  <span className="min-w-0 text-[12.5px] text-body-soft">{step.detail}</span>
                </div>
              ))}
            </div>
          ) : null}

          <p className="m-0 max-w-[700px] text-[14.5px] leading-[1.65]">
            {answer?.body ??
              "No conversation yet — ask about a bill, category or trend to start one."}
          </p>

          <div className="min-w-0 overflow-hidden rounded-[20px] border border-line bg-surface">
            <div className="px-[10px] pt-3 pb-[14px]">
              <VendorTrendChart trend={trend} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-[6px] flex items-center gap-2 rounded-[20px] border border-line bg-surface px-[14px] py-3">
        <span className="min-w-0 flex-1 text-[14px] text-faint">
          Ask about any bill, category or trend…
        </span>
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-lime"
        >
          Send
        </button>
      </div>
    </PageBody>
  );
}
