"use client";

import { useCallback, useEffect, useState } from "react";

export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
};

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** VAPID keys are base64url; PushManager wants the raw bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export type PushState = "unsupported" | "off" | "on" | "blocked" | "busy";

/** A background job still running (a bulk email trash), shown with live progress in Updates. */
export type RunningJob = {
  jobId: string;
  title: string;
  status: { state: string; done: number; total: number; error: string | null; paused?: boolean };
};

/** Dispatch after starting a background job, so Updates picks it up right away instead of on the next poll. */
export const JOBS_CHANGED_EVENT = "clandar:jobs-changed";

/**
 * The signed-in person's notifications (due reminders, lead digests, finished
 * email trashes …) and running background jobs, shown as the assistant's
 * Updates in the chat, with the unread count on its button.
 * Polls every minute and whenever the tab regains focus — reminders fire on a
 * 5-minute cycle, so that's plenty. Also owns browser push for this device.
 */
export function useNotifications() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [jobs, setJobs] = useState<RunningJob[]>([]);
  const [push, setPush] = useState<PushState>("unsupported");
  const [pushError, setPushError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/notifications", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { items: NotificationItem[]; unread: number; jobs?: RunningJob[] };
    setItems(data.items);
    setUnread(data.unread);
    setJobs(data.jobs ?? []);
  }, []);

  // Every minute — every 10s while a job is running, so its "done" notification lands promptly.
  const running = jobs.length > 0;
  useEffect(() => {
    // The first load and every refresh happen after an await, never synchronously in the effect.
    const tick = () => void load();
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, running ? 10_000 : 60_000);
    // A job just started (e.g. "Trash all spam"): give the server a moment to enqueue it, then look.
    const onJobsChanged = () => setTimeout(tick, 1500);
    window.addEventListener("focus", tick);
    window.addEventListener(JOBS_CHANGED_EVENT, onJobsChanged);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      window.removeEventListener(JOBS_CHANGED_EVENT, onJobsChanged);
    };
  }, [load, running]);

  // Work out this browser's push state once (after mount — none of this exists on the server).
  useEffect(() => {
    if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    let cancelled = false;
    (async () => {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const sub = await reg.pushManager.getSubscription();
      if (cancelled) return;
      setPush(Notification.permission === "denied" ? "blocked" : sub ? "on" : "off");
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** Marks one notification read, or all of them without an id. */
  const markRead = useCallback(
    async (id?: string) => {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(id ? { id } : {}),
      }).catch(() => {});
      await load();
    },
    [load],
  );

  const togglePush = useCallback(async () => {
    setPushError(null);
    const was = push;
    setPush("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (was === "on" && existing) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        await existing.unsubscribe();
        setPush("off");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPush(permission === "denied" ? "blocked" : "off");
        return;
      }
      const sub =
        existing ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't save.");
      setPush("on");
    } catch (error) {
      setPush(was === "busy" ? "off" : was);
      setPushError(error instanceof Error ? error.message : "Couldn't change browser notifications.");
    }
  }, [push]);

  return { items, unread, jobs, reload: load, markRead, push, pushError, togglePush };
}

export type Notifications = ReturnType<typeof useNotifications>;
