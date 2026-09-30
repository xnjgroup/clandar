import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { count } from "@/lib/data";

export type MailboxNavItem = { id: string; label: string; icon: IconName; href: string; count?: number; badge?: number };

/**
 * The email page's views. Desktop: a left side column (like Gmail's), with
 * counts. Phones: the same items as one sideways-scrolling row of chips.
 */
export function MailboxNav({ items, active }: { items: MailboxNavItem[]; active: string }) {
  return (
    <nav
      aria-label="Mailbox views"
      className="-mx-[14px] flex gap-[7px] overflow-x-auto px-[14px] [scrollbar-width:none] lg:sticky lg:top-[22px] lg:mx-0 lg:flex-col lg:gap-[2px] lg:overflow-visible lg:px-0"
    >
      {items.map((item) => {
        const on = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={on ? "page" : undefined}
            className={`flex shrink-0 items-center gap-[9px] rounded-full px-[14px] py-[8px] text-[12.5px] font-medium whitespace-nowrap lg:rounded-[12px] lg:px-[12px] lg:py-[9px] ${
              on ? "bg-ink text-bg" : "border border-line bg-surface text-body lg:border-transparent lg:bg-transparent lg:hover:bg-surface"
            }`}
          >
            <Icon name={item.icon} size={15} className={`hidden lg:block ${on ? "text-lime" : "text-body-soft"}`} />
            <span className="lg:flex-1">{item.label}</span>
            {item.badge ? (
              <span className={`rounded-full px-[7px] py-[1px] font-mono text-[10.5px] font-semibold ${on ? "bg-lime text-ink" : "bg-ok-bg text-ok-fg"}`}>
                {count(item.badge)}
              </span>
            ) : item.count !== undefined ? (
              <span className={`hidden font-mono text-[11px] lg:inline ${on ? "text-bg/70" : "text-faint"}`}>{count(item.count)}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
