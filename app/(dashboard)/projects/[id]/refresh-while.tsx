"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-fetches the page every few seconds while `active` — for work that finishes in the background, like an invoice being parsed. */
export function RefreshWhile({ active, everyMs = 3000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, router]);
  return null;
}
