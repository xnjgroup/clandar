"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { Notifications } from "@/components/use-notifications";

function ago(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/**
 * The chat panel's Updates (the bell in its header): notifications (due reminders, lead digests …)
 * shown as messages from Aide, newest at the bottom like a chat.
 * Viewing them marks them read; the ones that were new stay highlighted
 * until the tab is closed. The browser-push switch for this device sits below.
 */
export function AideUpdates({
  notifications,
  onNavigate,
}: {
  notifications: Notifications;
  onNavigate: () => void;
}) {
  const { items, unread, markRead, push, pushError, togglePush } = notifications;
  // Remember which were unread when the tab opened, so they stay marked "new" after being read.
  const [fresh] = useState(() => new Set(items.filter((n) => !n.read).map((n) => n.id)));
  useEffect(() => {
    if (unread > 0) void markRead();
  }, [unread, markRead]);
  // Newest is at the bottom, like the chat — start scrolled there.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items.length]);

  const ordered = [...items].reverse();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto px-[14px] py-[14px]">
        {ordered.length === 0 ? (
          <p className="m-0 text-[12px] leading-[1.5] text-muted">
            Nothing yet — I&rsquo;ll post here when a reminder is due or new leads come in.
          </p>
        ) : (
          ordered.map((n) => {
            const isNew = fresh.has(n.id) || !n.read;
            return (
              <div key={n.id} className="flex max-w-[92%] flex-col gap-[4px] self-start">
                <div
                  className={`flex flex-col gap-[3px] rounded-[16px] px-[12px] py-[9px] text-[15px] leading-[1.5] sm:text-[12.5px] ${
                    isNew ? "border border-[#cfe3a8] bg-[#f3f9e6]" : "bg-bg"
                  }`}
                >
                  <span className="flex items-center gap-[6px] font-semibold text-ink">
                    {isNew ? <span className="size-[7px] shrink-0 rounded-full bg-ok-fg" /> : null}
                    {n.title}
                  </span>
                  {n.body ? <span className="whitespace-pre-line text-body">{n.body}</span> : null}
                  {n.link ? (
                    <Link
                      href={n.link}
                      onClick={onNavigate}
                      className="mt-[2px] self-start text-[0.92em] font-medium text-ok-fg underline underline-offset-2"
                    >
                      Open →
                    </Link>
                  ) : null}
                </div>
                <span className="px-[4px] font-mono text-[10.5px] text-faint">{ago(n.createdAt)}</span>
              </div>
            );
          })
        )}
      </div>
      {push !== "unsupported" ? (
        <div className="flex shrink-0 flex-col gap-[4px] border-t border-line-soft px-[14px] py-[10px]">
          <label className="flex items-center gap-[8px] text-[12px]">
            <input
              type="checkbox"
              checked={push === "on"}
              disabled={push === "busy" || push === "blocked"}
              onChange={() => void togglePush()}
            />
            <Icon name="bellSm" size={13} className="text-body-soft" />
            Browser notifications on this device
          </label>
          {push === "blocked" ? (
            <span className="text-[11px] text-muted">Blocked in this browser&rsquo;s site settings — allow notifications there first.</span>
          ) : null}
          {pushError ? <span className="text-[11px] text-bad-fg">{pushError}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
