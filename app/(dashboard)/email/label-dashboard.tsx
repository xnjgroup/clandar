import Link from "next/link";
import { count, hrefWith } from "@/lib/data";
import { LABEL_QUERIES, type LabelCount } from "@/lib/gmail";

const PATH = "/email";

/**
 * Gmail's label counts (Inbox, Updates, Promotions, Trash…) as tiles, each
 * opening that label's mail on /email — where the promotional/spam ones get a
 * "Trash all" button. Lives on the cleanup page: it's an inbox-cleanup overview,
 * not something to scroll past every time you read mail.
 */
export function LabelDashboard({
  labels,
  accounts,
  accountId,
  params,
}: {
  labels: LabelCount[];
  accounts: number;
  accountId: string;
  params: Record<string, string | string[] | undefined>;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-[8px]">
      {labels.map((l) => (
        <Link
          key={l.id}
          href={hrefWith(PATH, params, {
            view: "all",
            q: LABEL_QUERIES[l.id],
            account: accounts > 1 ? accountId : null,
            t: null,
          })}
          className="flex shrink-0 items-center gap-[7px] rounded-[12px] border border-line bg-surface px-[11px] py-[8px] hover:bg-[#fafbf9]"
        >
          <span className="text-[11.5px] text-muted">{l.label}</span>
          <span className="font-mono text-[12.5px] font-semibold">{count(l.total)}</span>
          {l.unread > 0 ? (
            <span className="rounded-full bg-ok-bg px-[6px] py-[1px] font-mono text-[10px] text-ok-fg">
              {count(l.unread)} new
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

