"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";

export type MapStop = { id: string; n: number; lat: number; lng: number; label: string };

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
          <Tooltip direction="top" offset={[0, -12]}>
            {s.label}
          </Tooltip>
        </Marker>
      ))}
      <FitBounds points={line.length > 1 ? line : points} />
    </MapContainer>
  );
}
