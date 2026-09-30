"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const noSubscribe = () => () => {};
export const HEADER_ACTIONS_ID = "page-header-actions";

/**
 * Puts a page's main action (e.g. "Add to schedule") in the app header's
 * top-right slot (components/app-shell.tsx), so server-rendered pages can fill
 * it. The slot only exists in the browser, so this renders after hydration.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useSyncExternalStore(
    noSubscribe,
    () => document.getElementById(HEADER_ACTIONS_ID),
    () => null,
  );
  return slot ? createPortal(children, slot) : null;
}
