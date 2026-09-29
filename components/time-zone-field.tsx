"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * A hidden `timeZone` form field holding the browser's IANA zone, so the server
 * knows what "Oct 3, 9:00" means for this person (reminders fire in it). Empty
 * in the server render (it can't know the zone) and filled in on the client,
 * which useSyncExternalStore does without a hydration mismatch.
 */
export function TimeZoneField() {
  const zone = useSyncExternalStore(
    noSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "",
  );
  return <input type="hidden" name="timeZone" value={zone} />;
}
