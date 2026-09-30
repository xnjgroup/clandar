"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * A time shown in the viewer's own zone. The server may run in UTC (Vercel) and
 * doesn't know the viewer's zone, so it renders nothing and the browser fills
 * the text in right after hydration (useSyncExternalStore avoids a mismatch).
 */
export function LocalTime({ value, options }: { value: Date | string; options: Intl.DateTimeFormatOptions }) {
  const text = useSyncExternalStore(
    noSubscribe,
    () => new Date(value).toLocaleString("en-US", options),
    () => "",
  );
  return <time dateTime={new Date(value).toISOString()}>{text}</time>;
}
