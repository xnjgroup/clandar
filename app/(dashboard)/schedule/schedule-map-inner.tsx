"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";

/** A numbered pin; `when`, `title` and `place` make up its hover card. */
export type MapStop = { id: string; n: number; lat: number; lng: number; when: string; title: string; place: string };

/** Numbered pin, drawn with CSS (Leaflet's default image icons don't survive bundling). */
function numberIcon(n: number) {
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;background:#101211;color:#d8f36a;font:600 12px/1 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 2px 6px rgba(16,18,17,.35)">${n}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

/** Keeps every stop (and the route) in view whenever they change. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = JSON.stringify(points);
  useEffect(() => {
    const pts = JSON.parse(key) as [number, number][];
    if (pts.length === 1) map.setView(pts[0], 13);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 14 });
  }, [key, map]);
  return null;
}

/** The Leaflet map itself — loaded only in the browser (see schedule-map.tsx). */
export default function ScheduleMapInner({
  stops,
  line,
  dashed,
}: {
  stops: MapStop[];
  line: [number, number][];
  dashed: boolean;
}) {
  const points: [number, number][] = stops.map((s) => [s.lat, s.lng]);
  return (
    <MapContainer
      center={points[0] ?? [40.7, -74]}
      zoom={11}
      scrollWheelZoom={false}
      className="h-full w-full"
      attributionControl
    >
      {/* OpenStreetMap's standard tiles: free and keyless for light use like this (attribution
          required). CARTO's basemaps, the first choice, now answer "API key required". */}
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {line.length > 1 ? (
        <Polyline
          positions={line}
          pathOptions={{ color: "#101211", weight: 4, opacity: 0.75, dashArray: dashed ? "6 8" : undefined }}
        />
      ) : null}
      {stops.map((s) => (
        <Marker key={s.id} position={[s.lat, s.lng]} icon={numberIcon(s.n)}>
          {/* Leaflet's tooltip is one nowrap line by default — this one is a small card that wraps
              (schedule-map-tip in globals.css), with long notes clamped. */}
          <Tooltip direction="top" offset={[0, -14]} className="schedule-map-tip">
            <div className="flex w-[240px] max-w-[70vw] flex-col gap-[3px]">
              <span className="flex items-center gap-[6px] font-mono text-[11px] text-muted">
                <span className="flex size-[16px] shrink-0 items-center justify-center rounded-full bg-ink text-[9.5px] font-semibold text-lime">
                  {s.n}
                </span>
                {s.when}
              </span>
              <span className="line-clamp-3 text-[12.5px] leading-[1.4] font-semibold text-ink">{s.title}</span>
              {s.place ? <span className="line-clamp-2 text-[11px] leading-[1.35] text-muted">{s.place}</span> : null}
            </div>
          </Tooltip>
        </Marker>
      ))}
      <FitBounds points={line.length > 1 ? line : points} />
    </MapContainer>
  );
}
