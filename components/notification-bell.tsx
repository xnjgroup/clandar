"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";

type Item = { id: string; title: string; body: string; link: string | null; read: boolean; createdAt: string };

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function ago(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** VAPID keys are base64url; PushManager wants the raw bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

type PushState = "unsupported" | "off" | "on" | "blocked" | "busy";

/**
 * The header bell: unread count, the latest notifications (due reminders so
 * far), and a switch for browser push on this device. Polls every minute and
 * whenever the tab regains focus — reminders fire on a 5-minute cycle, so
 * that's plenty.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [push, setPush] = useState<PushState>("unsupported");
  const [pushError, setPushError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/notifications", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { items: Item[]; unread: number };
    setItems(data.items);
    setUnread(data.unread);
  }, []);

  useEffect(() => {
    // The first load and every refresh happen after an await, never synchronously in the effect.
    const tick = () => void load();
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [load]);

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

  // Click-outside / Escape close the panel, like the other popovers.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(id?: string) {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(id ? { id } : {}),
    }).catch(() => {});
    await load();
  }

  async function togglePush() {
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
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
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
  }

  return (
    <div ref={boxRef} className="relative ml-auto shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative flex size-9 cursor-pointer items-center justify-center rounded-[12px] border border-line bg-surface"
      >
        <Icon name="alert" size={17} />
        {unread > 0 ? (
          <span className="absolute -top-[5px] -right-[5px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-bad-fg px-[4px] text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute top-[calc(100%+8px)] right-0 z-50 flex w-[min(340px,calc(100vw-28px))] flex-col rounded-[16px] border border-line bg-surface shadow-[0_14px_40px_rgba(16,18,17,0.16)]">
          <div className="flex items-center gap-[8px] border-b border-line-soft px-[14px] py-[10px]">
            <span className="text-[13px] font-semibold">Notifications</span>
            {unread > 0 ? (
              <button type="button" onClick={() => void markRead()} className="ml-auto cursor-pointer text-[11.5px] underline">
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="flex max-h-[360px] flex-col overflow-y-auto">
            {items.length === 0 ? (
              <p className="m-0 px-[14px] py-[16px] text-[12px] text-muted">Nothing yet — due reminders show up here.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void markRead(n.id);
                    if (n.link) router.push(n.link);
                  }}
                  className="flex cursor-pointer flex-col gap-[2px] border-b border-line-faint px-[14px] py-[9px] text-left hover:bg-[#fafbf9]"
                >
                  <span className="flex items-center gap-[6px]">
                    {n.read ? null : <span className="size-[7px] shrink-0 rounded-full bg-ok-fg" />}
                    <span className={`min-w-0 flex-1 truncate text-[12.5px] ${n.read ? "" : "font-semibold"}`}>{n.title}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-faint">{ago(n.createdAt)}</span>
                  </span>
                  {n.body ? <span className="line-clamp-2 text-[11.5px] text-muted">{n.body}</span> : null}
                </button>
              ))
            )}
          </div>
          {push !== "unsupported" ? (
            <div className="flex flex-col gap-[4px] border-t border-line-soft px-[14px] py-[10px]">
              <label className="flex items-center gap-[8px] text-[12px]">
                <input
                  type="checkbox"
                  checked={push === "on"}
                  disabled={push === "busy" || push === "blocked"}
                  onChange={() => void togglePush()}
                />
                Browser notifications on this device
              </label>
              {push === "blocked" ? (
                <span className="text-[11px] text-muted">Blocked in this browser&rsquo;s site settings — allow notifications there first.</span>
              ) : null}
              {pushError ? <span className="text-[11px] text-bad-fg">{pushError}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
