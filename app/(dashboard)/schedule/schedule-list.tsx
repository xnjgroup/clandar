"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { EmptyRow } from "@/components/ui";
import type { ScheduleEntry } from "@/lib/schedule";
import { removeScheduleEntry } from "./actions";
import { EditScheduleDialog } from "./add-to-schedule-dialog";

const noSubscribe = () => () => {};
const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * The schedule, grouped by day. Rendered in the browser so days and times are
 * in the viewer's own zone (the server may run in UTC and doesn't know it).
 */
export function ScheduleList({
  entries,
  projects,
  members,
  redirectPath,
}: {
  entries: ScheduleEntry[];
  projects: { id: string; title: string }[];
  members: { id: string; name: string }[];
  redirectPath: string;
}) {
  const onClient = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const [editing, setEditing] = useState<ScheduleEntry | null>(null);
  if (entries.length === 0) return <EmptyRow>Nothing scheduled in the next 30 days.</EmptyRow>;
  if (!onClient) return <div className="min-h-[120px] border-t border-line-soft" />;

  const days = new Map<string, ScheduleEntry[]>();
  for (const entry of entries) {
    const key = new Date(entry.startsAt).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    days.set(key, [...(days.get(key) ?? []), entry]);
  }

  return (
    <>
      {Array.from(days.entries()).map(([day, dayEntries]) => (
        <div key={day} className="border-t border-line-soft">
          <div className="bg-[#fafbf9] px-[18px] py-[8px] text-[11.5px] font-semibold text-body-soft">{day}</div>
          {dayEntries.map((entry) => {
            const title = entry.notes || entry.projectTitle || "Scheduled";
            const sub = [entry.notes ? entry.projectTitle : null, entry.customerName].filter(Boolean).join(" · ");
            return (
              <div
                key={entry.id}
                className="flex min-h-[56px] items-start gap-3 border-t border-line-soft px-[18px] py-[11px]"
              >
                <span className="w-[74px] shrink-0 pt-[2px] font-mono text-[11px] leading-[1.4] text-muted sm:w-[140px]">
                  {time(new Date(entry.startsAt))}
                  <span className="hidden sm:inline"> – </span>
                  <br className="sm:hidden" />
                  {time(new Date(entry.endsAt))}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[2px] leading-[1.35]">
                  {entry.projectId ? (
                    <Link
                      href={`/projects/${entry.projectId}`}
                      className="line-clamp-2 text-[13px] font-semibold hover:underline"
                    >
                      {title}
                    </Link>
                  ) : (
                    <span className="line-clamp-2 text-[13px] font-semibold">{title}</span>
                  )}
                  {sub ? <span className="truncate text-[11.5px] text-muted">{sub}</span> : null}
                  {entry.location ? (
                    <span className="flex items-center gap-[5px] truncate text-[11px] text-body-soft">
                      <Icon name="pin" size={11} className="shrink-0" />
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
                <div className="flex shrink-0 items-start gap-[10px] pt-[2px]">
                  <button
                    type="button"
                    onClick={() => setEditing(entry)}
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
            );
          })}
        </div>
      ))}
      <EditScheduleDialog
        entry={editing}
        onClose={() => setEditing(null)}
        projects={projects}
        members={members}
        redirectPath={redirectPath}
      />
    </>
  );
}
