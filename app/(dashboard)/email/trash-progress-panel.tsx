"use client";

import { useJobProgress, type JobProgress } from "./use-job-progress";

/**
 * Live progress for one label's bulk trash — pushed over SSE
 * (`useJobProgress`), not polled. Only this small component re-renders as
 * updates arrive; the rest of the page stays exactly as the server sent it.
 */
export function TrashProgressPanel({
  jobId,
  labelName,
  initial,
}: {
  jobId: string;
  labelName: string;
  initial: JobProgress;
}) {
  const status = useJobProgress(jobId, initial) ?? initial;
  const pct = status.total > 0 ? Math.round((status.done / status.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-[6px] rounded-[14px] border border-line bg-surface px-[14px] py-[11px]">
      <div className="flex flex-wrap items-center gap-[9px] text-[12px]">
        <span className="font-medium">
          {status.state === "failed"
            ? `Trashing ${labelName.toLowerCase()} failed`
            : status.state === "completed"
              ? `Trashed all ${labelName.toLowerCase()}`
              : `Trashing ${labelName.toLowerCase()}…`}
        </span>
        <span className="font-mono text-[11px] text-faint">
          {status.done.toLocaleString("en-US")}
          {status.total > 0 ? ` / ${status.total.toLocaleString("en-US")}` : ""}
        </span>
      </div>
      {status.state === "failed" ? (
        <span className="text-[11.5px] text-bad-fg">{status.error}</span>
      ) : status.total > 0 && status.state !== "completed" ? (
        <div className="h-[6px] overflow-hidden rounded-[3px] bg-line-soft">
          <div className="h-full rounded-[3px] bg-meter-ok transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}
