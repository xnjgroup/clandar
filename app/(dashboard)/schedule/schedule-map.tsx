"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import type { ScheduleEntry } from "@/lib/schedule";
import type { MapStop } from "./schedule-map-inner";

// Leaflet touches `window` on import, so the map only loads in the browser.
const ScheduleMapInner = dynamic(() => import("./schedule-map-inner"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-line-soft" />,
});

const OSRM = "https://router.project-osrm.org/route/v1/driving";
/** Legs longer than this are flights or long hauls — drawn as a straight dashed line, not a road route. */
const MAX_DRIVE_LEG_KM = 250;

const time = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dayKey = (d: Date) => d.toLocaleDateString("en-CA");
const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

type Route = { key: string; line: [number, number][]; miles: number; minutes: number } | null;

/**
 * The schedule on a map: numbered stops in time order, one day at a time (or
 * all days), with the driving route between a day's stops (OSRM) and a
 * Directions button that opens them in Google Maps. Entries whose place
 * couldn't be found are listed underneath.
 */
export function ScheduleMap({ entries }: { entries: ScheduleEntry[] }) {
  const days = Array.from(new Set(entries.map((e) => dayKey(new Date(e.startsAt)))));
  const today = dayKey(new Date());
  const [day, setDay] = useState<string>(() => days.find((d) => d >= today) ?? days[days.length - 1] ?? "all");
  const [route, setRoute] = useState<Route>(null);

  const inView = entries.filter((e) => day === "all" || dayKey(new Date(e.startsAt)) === day);
  const located = inView.filter((e): e is ScheduleEntry & { lat: number; lng: number } => e.lat !== null && e.lng !== null);
  const missing = inView.filter((e) => e.lat === null || e.lng === null);
  const stops: MapStop[] = located.map((e, i) => ({
    id: e.id,
    n: i + 1,
    lat: e.lat,
    lng: e.lng,
    label: `${time(new Date(e.startsAt))} · ${e.notes || e.location || e.projectTitle || "Scheduled"}`,
  }));
  const straight: [number, number][] = stops.map((s) => [s.lat, s.lng]);
  const drivable =
    day !== "all" && stops.length > 1 && stops.every((s, i) => i === 0 || km(stops[i - 1], s) <= MAX_DRIVE_LEG_KM);
  const routeKey = drivable ? stops.map((s) => `${s.lng},${s.lat}`).join(";") : "";

  // Road route for one day's stops; anything else (all days, long legs, OSRM down) is a dashed straight line.
  useEffect(() => {
    if (!routeKey) return;
    let cancelled = false;
    fetch(`${OSRM}/${routeKey}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[] } | null) => {
        const best = data?.routes?.[0];
        if (cancelled || !best) return;
        setRoute({
          key: routeKey,
          line: best.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          miles: best.distance / 1609.34,
          minutes: best.duration / 60,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [routeKey]);

  const road = route && route.key === routeKey ? route : null;
  const directions =
    stops.length > 0
      ? `https://www.google.com/maps/dir/?${new URLSearchParams({
          api: "1",
          destination: `${stops[stops.length - 1].lat},${stops[stops.length - 1].lng}`,
          travelmode: "driving",
          ...(stops.length > 1 ? { origin: `${stops[0].lat},${stops[0].lng}` } : {}),
          ...(stops.length > 2
            ? { waypoints: stops.slice(1, -1).map((s) => `${s.lat},${s.lng}`).join("|") }
            : {}),
        })}`
      : null;

  const chip = (on: boolean) =>
    `shrink-0 cursor-pointer rounded-full px-[11px] py-[5px] text-[11.5px] font-medium ${
      on ? "bg-ink text-bg" : "border border-line bg-surface text-body"
    }`;

  return (
    <div className="flex flex-col gap-[10px] px-[18px] pt-[8px] pb-[14px]">
      <div className="-mx-[18px] flex gap-[6px] overflow-x-auto px-[18px] [scrollbar-width:none]">
        {days.map((d) => (
          <button key={d} type="button" onClick={() => setDay(d)} className={chip(day === d)}>
            {d === today ? "Today" : dayLabel(new Date(`${d}T12:00:00`))}
          </button>
        ))}
        {days.length > 1 ? (
          <button type="button" onClick={() => setDay("all")} className={chip(day === "all")}>
            All days
          </button>
        ) : null}
      </div>

      {stops.length > 0 ? (
        <div className="relative z-0 h-[300px] overflow-hidden rounded-[14px] border border-line-soft sm:h-[360px]">
          <ScheduleMapInner stops={stops} line={road ? road.line : straight} dashed={!road} />
        </div>
      ) : (
        <div className="flex h-[120px] items-center justify-center rounded-[14px] border border-dashed border-line text-center text-[12px] text-muted">
          No places to show {day === "all" ? "yet" : "for this day"} — add a “Where” to schedule entries.
        </div>
      )}

      {stops.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px]">
          {road ? (
            <span className="text-[12px] text-body-soft">
              {road.miles.toFixed(road.miles < 10 ? 1 : 0)} mi · {Math.round(road.minutes)} min driving
            </span>
          ) : day === "all" && stops.length > 1 ? (
            <span className="text-[12px] text-muted">Pick a day to see the driving route.</span>
          ) : stops.length > 1 && !drivable ? (
            <span className="text-[12px] text-muted">Too far apart to drive — shown as a straight line.</span>
          ) : null}
          {directions ? (
            <a
              href={directions}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex h-[34px] items-center gap-[6px] rounded-full bg-ink px-4 text-[12px] font-semibold text-bg"
            >
              <Icon name="map" size={14} />
              Directions
            </a>
          ) : null}
        </div>
      ) : null}

      <ol className="m-0 flex list-none flex-col gap-[6px] p-0">
        {located.map((e, i) => (
          <li key={e.id} className="flex items-start gap-[10px] text-[12px]">
            <span className="mt-[1px] flex size-[20px] shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[10.5px] font-semibold text-lime">
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-col leading-[1.4]">
              <span className="truncate">
                <span className="font-mono text-muted">
                  {day === "all" ? `${dayLabel(new Date(e.startsAt))} · ` : ""}
                  {time(new Date(e.startsAt))}
                </span>{" "}
                <span className="font-medium text-ink">{e.notes || e.projectTitle || "Scheduled"}</span>
              </span>
              <span className="truncate text-[11px] text-muted">{e.location || e.projectAddress}</span>
            </span>
          </li>
        ))}
        {missing.map((e) => (
          <li key={e.id} className="flex items-start gap-[10px] text-[12px] text-muted">
            <span className="mt-[1px] flex size-[20px] shrink-0 items-center justify-center rounded-full border border-dashed border-line">
              <Icon name="pin" size={11} />
            </span>
            <span className="min-w-0 truncate leading-[1.4]">
              {time(new Date(e.startsAt))} {e.notes || "Scheduled"} —{" "}
              {e.location || e.projectAddress ? "looking up the place…" : "no place set"}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
