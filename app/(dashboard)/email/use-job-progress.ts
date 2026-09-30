"use client";

import { useEffect, useState } from "react";

/**
 * Mirrors `lib/queue.ts`'s `JobStatus` — redefined here rather than imported,
 * since that module pulls in `bullmq`/`ioredis` (Node-only) and this file
 * ships to the browser.
 */
export type JobProgress = {
  state: string;
  done: number;
  total: number;
  error: string | null;
  /** A bulk trash the person paused from the assistant's Updates. */
  paused?: boolean;
};

/**
 * Subscribes to a BullMQ job's live progress over SSE
 * (`/api/gmail-jobs/[jobId]`) — no polling, no `router.refresh()`. Starts from
 * the server-rendered `initial` status for a correct first paint, and only
 * opens a connection while that status is still in progress; a job already
 * completed or failed needs no live updates.
 */
export function useJobProgress(jobId: string | null, initial: JobProgress | null): JobProgress | null {
  const [status, setStatus] = useState(initial);
  // Resets to `initial` when the job identity changes, without calling
  // setState from inside an effect — adjusting state during render, per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const [trackedJobId, setTrackedJobId] = useState(jobId);
  if (jobId !== trackedJobId) {
    setTrackedJobId(jobId);
    setStatus(initial);
  }

  useEffect(() => {
    if (!jobId || !initial || initial.state === "completed" || initial.state === "failed") return;

    const source = new EventSource(`/api/gmail-jobs/${jobId}`);
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as JobProgress | { done: true };
      if ("state" in data) setStatus(data);
      else source.close(); // the {done:true} sentinel — the stream is finished
    };
    source.onerror = () => source.close();
    return () => source.close();
    // Only reopen if the job identity or its starting point actually changes —
    // `initial` itself updates on every keystroke-adjacent render otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  return status;
}
