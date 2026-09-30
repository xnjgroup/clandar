"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChatMarkdown } from "@/components/chat-markdown";
import { playSound, setSoundEnabled, soundEnabled } from "@/components/notification-sound";
import { Icon } from "@/components/icons";
import type { Notifications, RunningJob } from "@/components/use-notifications";
import { useJobProgress } from "@/app/(dashboard)/email/use-job-progress";

/**
 * A running job as a live message: title, count and progress bar, pushed over
 * SSE, with pause/resume and cancel. When it ends, `onFinished` refreshes
 * Updates (its "done" notification arrives there).
 */
function JobCard({ job, onFinished }: { job: RunningJob; onFinished: () => void }) {
  const status = useJobProgress(job.jobId, job.status) ?? job.status;
  // What was just asked for, until the worker's next progress report confirms it.
  const [requested, setRequested] = useState<"pause" | "resume" | "cancel" | null>(null);
  const finished = status.state === "completed" || status.state === "failed";
  useEffect(() => {
    if (finished) onFinished();
  }, [finished, onFinished]);

  const [seenPaused, setSeenPaused] = useState(status.paused);
  if (status.paused !== seenPaused) {
    setSeenPaused(status.paused);
    if (requested !== "cancel") setRequested(null);
  }
  const paused = requested === "pause" || (status.paused && requested !== "resume");
  const cancelling = requested === "cancel";

  async function control(action: "pause" | "resume" | "cancel") {
    setRequested(action);
    const res = await fetch(`/api/gmail-jobs/${job.jobId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    if (!res?.ok) setRequested(null);
  }

  const pct = status.total > 0 ? Math.round((status.done / status.total) * 100) : 0;
  const iconButton =
    "flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-line text-body-soft hover:text-ink disabled:cursor-default disabled:opacity-40";
  return (
    <div className="flex w-full flex-col gap-[6px] rounded-[16px] border border-line bg-surface px-[12px] py-[10px]">
      <span className="flex items-center gap-[8px] text-[13px] font-semibold sm:text-[12.5px]">
        <span
          className={`size-[7px] shrink-0 rounded-full ${paused || cancelling ? "bg-warn-fg" : "animate-pulse bg-meter-ok"}`}
        />
        <span className="min-w-0 flex-1 truncate">{job.title}</span>
        <button
          type="button"
          onClick={() => void control(paused ? "resume" : "pause")}
          disabled={cancelling}
          aria-label={paused ? "Resume" : "Pause"}
          title={paused ? "Resume" : "Pause"}
          className={iconButton}
        >
          <Icon name={paused ? "play" : "pause"} size={12} />
        </button>
        <button
          type="button"
          onClick={() => void control("cancel")}
          disabled={cancelling}
          aria-label="Cancel"
          title="Cancel — stop here; what's already trashed stays in Trash"
          className={`${iconButton} hover:text-bad-fg`}
        >
          <Icon name="close" size={12} />
        </button>
      </span>
      <div className="h-[6px] overflow-hidden rounded-[3px] bg-line-soft">
        <div
          className={`h-full rounded-[3px] transition-[width] ${paused || cancelling ? "bg-warn-fg" : "bg-meter-ok"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="flex items-center gap-[6px] text-[11px] text-muted">
        <span className="font-mono">
          {status.done.toLocaleString("en-US")}
          {status.total > 0 ? ` / ${status.total.toLocaleString("en-US")}` : ""}
        </span>
        ·{" "}
        {cancelling
          ? "Stopping…"
          : paused
            ? "Paused — resume any time."
            : "Running in the background — I\u2019ll let you know when it\u2019s done."}
      </span>
    </div>
  );
}

/** "Sound on this device" — plays a sample chime when switched on. */
function SoundToggle() {
  const [on, setOn] = useState(soundEnabled);
  return (
    <label className="flex items-center gap-[8px] text-[12px]">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          setSoundEnabled(e.target.checked);
          if (e.target.checked) playSound("notification");
        }}
      />
      Sound on this device
    </label>
  );
}

/** The conversation a notification's link opens (`?chat=<id>`), if it's one of those. */
function chatId(link: string | null): string | null {
  return link?.match(/[?&]chat=([0-9a-f-]{36})/i)?.[1] ?? null;
}

function ago(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/**
 * The chat panel's Updates (the bell in its header): notifications (due reminders, lead digests …)
 * shown as messages from the assistant, newest at the bottom like a chat.
 * Viewing them marks them read; the ones that were new stay highlighted
 * until the tab is closed. The browser-push switch for this device sits below.
 */
export function AssistantUpdates({
  notifications,
  onNavigate,
}: {
  notifications: Notifications;
  onNavigate: () => void;
}) {
  const { items, unread, jobs, reload, markRead, dismiss, push, pushError, togglePush } = notifications;
  // Remember which were unread when the tab opened, so they stay marked "new" after being read.
  const [fresh] = useState(() => new Set(items.filter((n) => !n.read).map((n) => n.id)));
  useEffect(() => {
    if (unread > 0) void markRead();
  }, [unread, markRead]);
  // Newest is at the bottom, like the chat — start scrolled there.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items.length, jobs.length]);

  const ordered = [...items].reverse();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto px-[14px] py-[14px]">
        {ordered.length > 1 ? (
          <button
            type="button"
            onClick={() => void dismiss()}
            className="-mb-[4px] cursor-pointer self-end text-[11.5px] font-medium text-muted underline hover:text-ink"
          >
            Clear all
          </button>
        ) : null}
        {ordered.length === 0 && jobs.length === 0 ? (
          <p className="m-0 text-[12px] leading-[1.5] text-muted">
            Nothing yet — I&rsquo;ll post here when a reminder is due or new leads come in.
          </p>
        ) : (
          ordered.map((n) => {
            const isNew = fresh.has(n.id) || !n.read;
            return (
              <div key={n.id} className="flex w-full flex-col gap-[4px]">
                <div
                  className={`flex flex-col gap-[3px] rounded-[16px] px-[12px] py-[9px] text-[15px] leading-[1.5] sm:text-[12.5px] ${
                    isNew ? "border border-[#cfe3a8] bg-[#f3f9e6]" : "bg-bg"
                  }`}
                >
                  <span className="flex items-start gap-[6px] font-semibold text-ink">
                    {isNew ? <span className="mt-[0.5em] size-[7px] shrink-0 rounded-full bg-ok-fg" /> : null}
                    <span className="min-w-0 flex-1">{n.title}</span>
                    <button
                      type="button"
                      onClick={() => void dismiss(n.id)}
                      aria-label="Dismiss"
                      title="Dismiss"
                      className="-mr-[4px] flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-full text-faint hover:bg-line-soft hover:text-ink"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                  {n.body ? (
                    // Markdown — automations (a daily briefing) write their reports that way.
                    <div className="text-body">
                      <ChatMarkdown text={n.body} onNavigate={onNavigate} />
                    </div>
                  ) : null}
                  {chatId(n.link) ? (
                    // A report posted to the chat (a daily briefing): open that conversation right here.
                    <button
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("clandar:open-assistant", { detail: { conversationId: chatId(n.link) } }),
                        )
                      }
                      className="mt-[4px] flex cursor-pointer items-center gap-[6px] self-start rounded-full bg-ink px-[12px] py-[6px] text-[12px] font-semibold text-lime"
                    >
                      <Icon name="chat" size={13} />
                      Open in chat
                    </button>
                  ) : n.link ? (
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
        {/* Still running — newest, so at the bottom. */}
        {jobs.map((job) => (
          <JobCard key={job.jobId} job={job} onFinished={reload} />
        ))}
      </div>
      <div className="flex shrink-0 flex-col gap-[6px] border-t border-line-soft px-[14px] py-[10px]">
        <SoundToggle />
      {push !== "unsupported" ? (
        <div className="flex flex-col gap-[4px]">
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
    </div>
  );
}
