"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { EmptyRow } from "@/components/ui";
import type { ScheduleEntry } from "@/lib/schedule";
import { removeScheduleEntry } from "./actions";

const noSubscribe = () => () => {};
const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dayKey = (d: Date) => d.toLocaleDateString("en-CA");

/**
 * The project's schedule as a vertical timeline: a rail down the left, one heading
 * per day, a dot per entry with its time window and what's happening. Past
 * entries are faded; long notes are clamped to three lines and expand on tap.
 * Rendered in the browser so days and times are in the viewer's own zone.
 */
function Timeline({ entries, redirectPath, now }: { entries: ScheduleEntry[]; redirectPath: string; now: number }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const today = dayKey(new Date(now));
  const days = new Map<string, ScheduleEntry[]>();
  for (const entry of entries) {
    const key = dayKey(new Date(entry.startsAt));
    days.set(key, [...(days.get(key) ?? []), entry]);
  }
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ol className="m-0 list-none px-[18px] py-[14px]">
      {Array.from(days.entries()).map(([key, dayEntries], dayIndex, all) => {
        const date = new Date(dayEntries[0].startsAt);
        const isToday = key === today;
        const isPastDay = key < today;
        const lastDay = dayIndex === all.length - 1;
        return (
          <li key={key} className="relative pl-[26px]">
            {/* The rail: runs from this day's marker down to the next day's. */}
            {!lastDay ? <span className="absolute top-[14px] bottom-0 left-[6px] w-[2px] bg-line-soft" /> : null}
            <span
              className={`absolute top-[4px] left-0 size-[14px] rounded-full border-2 ${
                isToday ? "border-ink bg-lime" : isPastDay ? "border-line bg-surface" : "border-ink bg-surface"
              }`}
            />
            <div className={`flex items-baseline gap-[8px] ${isPastDay ? "opacity-60" : ""}`}>
              <span className="text-[13px] font-semibold">
                {date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </span>
              {isToday ? (
                <span className="rounded-full bg-lime px-[7px] py-[1px] text-[10.5px] font-semibold text-ink">Today</span>
              ) : null}
            </div>
            <div className={`flex flex-col gap-[10px] pt-[8px] ${lastDay ? "" : "pb-[18px]"}`}>
              {dayEntries.map((entry) => {
                const past = new Date(entry.endsAt).getTime() < now;
                const open = expanded.has(entry.id);
                return (
                  <div
                    key={entry.id}
                    className={`group flex items-start gap-[10px] rounded-[14px] border border-line-soft bg-bg px-[12px] py-[10px] ${
                      past ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                      <span className="font-mono text-[11px] text-muted">
                        {time(new Date(entry.startsAt))} – {time(new Date(entry.endsAt))}
                      </span>
                      {entry.notes ? (
                        <button
                          type="button"
                          onClick={() => toggle(entry.id)}
                          className={`cursor-pointer text-left text-[12.5px] leading-[1.45] text-ink ${open ? "" : "line-clamp-3"}`}
                        >
                          {entry.notes}
                        </button>
                      ) : (
                        <span className="text-[12.5px] text-muted">Scheduled</span>
                      )}
                      {entry.assignedName ? (
                        <span className="flex items-center gap-[5px] text-[11px] text-body-soft">
                          <Icon name="user" size={11} />
                          {entry.assignedName}
                        </span>
                      ) : null}
                    </div>
                    <form action={removeScheduleEntry}>
                      <input type="hidden" name="id" value={entry.id} />
                      <input type="hidden" name="redirectPath" value={redirectPath} />
                      <button type="submit" aria-label="Remove" className="cursor-pointer pt-[1px] text-faint hover:text-bad-fg">
                        <Icon name="close" size={13} />
                      </button>
                    </form>
                  </div>
                );
              })}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The project's schedule as a list: one row per entry, date and time first. */
function List({ entries, redirectPath }: { entries: ScheduleEntry[]; redirectPath: string }) {
  return entries.map((entry) => (
    <div key={entry.id} className="flex min-h-[52px] items-start gap-3 border-t border-line-soft px-[18px] py-[11px] first:border-t-0">
      <Icon name="calendar" size={16} className="mt-[1px] shrink-0 text-body-soft" />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px] leading-[1.35]">
        <span className="flex flex-wrap items-baseline gap-x-[8px] text-[12.5px] font-medium">
          {new Date(entry.startsAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          <span className="font-mono text-[11.5px] font-normal text-muted">
            {time(new Date(entry.startsAt))} – {time(new Date(entry.endsAt))}
          </span>
        </span>
        {entry.notes ? <span className="text-[12px] text-body">{entry.notes}</span> : null}
        {entry.assignedName ? (
          <span className="flex items-center gap-[5px] text-[11.5px] text-muted">
            <Icon name="user" size={12} />
            {entry.assignedName}
          </span>
        ) : null}
      </div>
      <form action={removeScheduleEntry}>
        <input type="hidden" name="id" value={entry.id} />
        <input type="hidden" name="redirectPath" value={redirectPath} />
        <button type="submit" aria-label="Remove" className="cursor-pointer text-faint hover:text-bad-fg">
          <Icon name="close" size={14} />
        </button>
      </form>
    </div>
  ));
}

type View = "list" | "timeline";
const VIEW_KEY = "clandar.project-schedule-view";
const viewListeners = new Set<() => void>();
let memoryView: View | null = null; // when storage is blocked (private mode)

// The chosen view is a per-device convenience (localStorage), read through
// useSyncExternalStore so the server render and hydration agree.
function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "timeline";
  } catch {
    return memoryView ?? "timeline";
  }
}
function writeView(view: View) {
  memoryView = view;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Storage blocked: memoryView keeps the choice for this visit.
  }
  viewListeners.forEach((l) => l());
}
function subscribeView(listener: () => void) {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

/**
 * A project's schedule with a Timeline / List switch — Timeline by default, the
 * choice remembered per device.
 * Rendered in the browser so days and times are in the viewer's own zone.
 */
export function ProjectSchedule({
  entries,
  redirectPath,
  emptyLabel,
}: {
  entries: ScheduleEntry[];
  redirectPath: string;
  emptyLabel: string;
}) {
  const now = useSyncExternalStore(noSubscribe, () => Date.now(), () => 0);
  const view = useSyncExternalStore(subscribeView, readView, () => "timeline" as View);
  if (entries.length === 0) return <EmptyRow>{emptyLabel}</EmptyRow>;
  if (!now) return <div className="min-h-[120px] border-t border-line-soft" />;

  const tab = (id: View, label: string) => (
    <button
      type="button"
      onClick={() => writeView(id)}
      aria-pressed={view === id}
      className={`cursor-pointer rounded-full px-[12px] py-[4px] text-[11.5px] font-medium ${
        view === id ? "bg-ink text-bg" : "text-body-soft hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="border-t border-line-soft">
      <div className="flex px-[18px] pt-[10px] pb-[2px]">
        <div role="group" aria-label="Schedule view" className="flex rounded-full border border-line bg-surface p-[2px]">
          {tab("timeline", "Timeline")}
          {tab("list", "List")}
        </div>
      </div>
      {view === "timeline" ? (
        <Timeline entries={entries} redirectPath={redirectPath} now={now} />
      ) : (
        <div className="pt-[6px]">
          <List entries={entries} redirectPath={redirectPath} />
        </div>
      )}
    </div>
  );
}
