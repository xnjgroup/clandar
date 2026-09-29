"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { useJobProgress, type JobProgress } from "../use-job-progress";

/**
 * Live progress for a running inbox scan — pushed over SSE (`useJobProgress`),
 * not polled. Once the job actually finishes, it does exactly one
 * `router.refresh()` (not an interval) so the candidates table and "last
 * scanned" summary pick up the results — everything in between only
 * re-renders this small component.
 */
export function ScanProgressPanel({ jobId, initial }: { jobId: string; initial: JobProgress }) {
  const router = useRouter();
  const status = useJobProgress(jobId, initial) ?? initial;
  const refreshed = useRef(false);

  useEffect(() => {
    if (refreshed.current) return;
    if (status.state === "completed" || status.state === "failed") {
      refreshed.current = true;
      router.refresh();
    }
  }, [status.state, router]);

  const pct = status.total > 0 ? Math.round((status.done / status.total) * 100) : 0;

  return (
    <span className="flex flex-wrap items-center gap-[10px]">
      <span className="flex items-center gap-[6px]">
        <Icon name="refresh" size={14} className="shrink-0" />
        Scanning your inbox…
      </span>
      <span className="font-mono text-[11px] text-faint">
        {status.done.toLocaleString("en-US")}
        {status.total > 0 ? ` / ${status.total.toLocaleString("en-US")}` : ""}
      </span>
      {status.total > 0 ? (
        <span className="h-[6px] w-[120px] overflow-hidden rounded-[3px] bg-line-soft">
          <span
            className="block h-full rounded-[3px] bg-meter-ok transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </span>
      ) : null}
    </span>
  );
}
