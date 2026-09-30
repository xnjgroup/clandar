"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { EmptyRow } from "@/components/ui";
import type { ScheduleEntry } from "@/lib/schedule";
import { removeScheduleEntry } from "./actions";
import { EditScheduleDialog } from "./add-to-schedule-dialog";
import { ScheduleMap } from "./schedule-map";

const noSubscribe = () => () => {};

/** On the Scheduled page (not inside a project), which project an entry belongs to. */
function ProjectLine({ entry, className }: { entry: ScheduleEntry; className: string }) {
  if (!entry.projectId || !entry.projectTitle) return null;
  return (
    <Link href={`/projects/${entry.projectId}`} className={`flex min-w-0 items-center gap-[5px] hover:underline ${className}`}>
      <Icon name="briefcase" size={11} className="shrink-0" />
      <span className="truncate">
        {entry.projectTitle}
        {entry.customerName ? ` · ${entry.customerName}` : ""}
      </span>
    </Link>
  );
}
const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dayKey = (d: Date) => d.toLocaleDateString("en-CA");

/**
 * The project's schedule as a vertical timeline: a rail down the left, one heading
 * per day, a dot per entry with its time window and what's happening. Past
 * entries are faded; long notes are clamped to three lines and expand on tap.
 * Rendered in the browser so days and times are in the viewer's own zone.
 */
function Timeline({
  entries,
  redirectPath,
  now,
  showProject,
  onEdit,
}: {
  entries: ScheduleEntry[];
  redirectPath: string;
  now: number;
  showProject: boolean;
  onEdit: (entry: ScheduleEntry) => void;
}) {
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
                      {showProject ? <ProjectLine entry={entry} className="text-[11px] text-body-soft" /> : null}
                      {entry.location ? (
                        <span className="flex items-start gap-[5px] text-[11px] text-body-soft">
                          <Icon name="pin" size={11} className="mt-[2px] shrink-0" />
                          {entry.location}
                        </span>
                      ) : null}
                      {entry.assignedName ? (
                        <span className="flex items-center gap-[5px] text-[11px] text-body-soft">
                          <Icon name="user" size={11} />
                          {entry.assignedName}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-start gap-[10px]">
                      <button
                        type="button"
                        onClick={() => onEdit(entry)}
                        aria-label="Edit"
                        title="Edit"
                        className="cursor-pointer pt-[1px] text-faint hover:text-ink"
                      >
                        <Icon name="pencil" size={13} />
                      </button>
                      <form action={removeScheduleEntry}>
                        <input type="hidden" name="id" value={entry.id} />
                        <input type="hidden" name="redirectPath" value={redirectPath} />
                        <button type="submit" aria-label="Remove" className="cursor-pointer pt-[1px] text-faint hover:text-bad-fg">
                          <Icon name="close" size={13} />
                        </button>
                      </form>
                    </div>
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
function List({
  entries,
  redirectPath,
  showProject,
  onEdit,
}: {
  entries: ScheduleEntry[];
  redirectPath: string;
  showProject: boolean;
  onEdit: (entry: ScheduleEntry) => void;
}) {
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
        {showProject ? <ProjectLine entry={entry} className="text-[11.5px] text-muted" /> : null}
        {entry.location ? (
          <span className="flex items-start gap-[5px] text-[11.5px] text-muted">
            <Icon name="pin" size={12} className="mt-[2px] shrink-0" />
            {entry.location}
          </span>
        ) : null}
        {entry.assignedName ? (
          <span className="flex items-center gap-[5px] text-[11.5px] text-muted">
            <Icon name="user" size={12} />
            {entry.assignedName}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-start gap-[10px]">
        <button
          type="button"
          onClick={() => onEdit(entry)}
          aria-label="Edit"
          title="Edit"
          className="cursor-pointer text-faint hover:text-ink"
        >
          <Icon name="pencil" size={14} />
        </button>
        <form action={removeScheduleEntry}>
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="redirectPath" value={redirectPath} />
          <button type="submit" aria-label="Remove" className="cursor-pointer text-faint hover:text-bad-fg">
            <Icon name="close" size={14} />
          </button>
        </form>
      </div>
    </div>
  ));
}

type View = "list" | "timeline" | "map";
const viewListeners = new Set<() => void>();
const memoryViews = new Map<string, View>(); // when storage is blocked (private mode)

// The chosen view is a per-device convenience (localStorage, one key per page),
// read through useSyncExternalStore so the server render and hydration agree.
function readView(key: string): View {
  try {
    const saved = localStorage.getItem(key);
    return saved === "list" || saved === "map" ? saved : "timeline";
  } catch {
    return memoryViews.get(key) ?? "timeline";
  }
}
function writeView(key: string, view: View) {
  memoryViews.set(key, view);
  try {
    localStorage.setItem(key, view);
  } catch {
    // Storage blocked: memoryViews keeps the choice for this visit.
  }
  viewListeners.forEach((l) => l());
}
function subscribeView(listener: () => void) {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

/**
 * Schedule entries with a Timeline / List / Map switch — Timeline by default,
 * the choice remembered per device (separately per `storageKey`). Inside a
 * project (`projectId`) entries stay on it; elsewhere each shows its project,
 * and editing can move it to another of `projects`.
 * Rendered in the browser so days and times are in the viewer's own zone.
 */
export function ScheduleViews({
  entries,
  projectId,
  projects,
  members,
  redirectPath,
  emptyLabel,
  storageKey,
}: {
  entries: ScheduleEntry[];
  projectId?: string;
  projects?: { id: string; title: string }[];
  members: { id: string; name: string }[];
  redirectPath: string;
  emptyLabel: string;
  storageKey: string;
}) {
  const [editing, setEditing] = useState<ScheduleEntry | null>(null);
  // Browser-only (so days and times are in the viewer's zone). The time is read once: a
  // useSyncExternalStore snapshot must return the same value on every call, and Date.now()
  // doesn't — that re-rendered forever ("Maximum update depth exceeded").
  const onClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [clientNow] = useState(() => Date.now());
  const now = onClient ? clientNow : 0;
  const view = useSyncExternalStore(
    subscribeView,
    () => readView(storageKey),
    () => "timeline" as View,
  );
  const showProject = !projectId;
  if (entries.length === 0) return <EmptyRow>{emptyLabel}</EmptyRow>;
  if (!now) return <div className="min-h-[120px] border-t border-line-soft" />;

  const tab = (id: View, label: string) => (
    <button
      type="button"
      onClick={() => writeView(storageKey, id)}
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
          {tab("map", "Map")}
        </div>
      </div>
      {view === "timeline" ? (
        <Timeline
          entries={entries}
          redirectPath={redirectPath}
          now={now}
          showProject={showProject}
          onEdit={setEditing}
        />
      ) : view === "map" ? (
        <ScheduleMap entries={entries} />
      ) : (
        <div className="pt-[6px]">
          <List entries={entries} redirectPath={redirectPath} showProject={showProject} onEdit={setEditing} />
        </div>
      )}
      <EditScheduleDialog
        entry={editing}
        onClose={() => setEditing(null)}
        projectId={projectId}
        projects={projects}
        members={members}
        redirectPath={redirectPath}
      />
    </div>
  );
}
