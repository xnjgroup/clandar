/**
 * Address → coordinates, for the schedule map and the assistant's map tools. Uses OpenStreetMap's Nominatim
 * (free, no key). Its usage policy asks for an identifying User-Agent and at
 * most one request a second, so results are stored on the row that needed them
 * and lookups happen one at a time.
 */
export type LatLng = { lat: number; lng: number };
export type Place = LatLng & { name: string };

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "clandar/1.0 (+https://clandar.com)";

/** The best match for `text`, or null if nothing's found or the service is unreachable. */
export async function geocode(text: string): Promise<LatLng | null> {
  const q = text.trim();
  if (!q) return null;
  try {
    const url = `${NOMINATIM}?${new URLSearchParams({ q, format: "jsonv2", limit: "1" })}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const [hit] = (await res.json()) as { lat: string; lon: string }[];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

/** Waits long enough between lookups to stay within Nominatim's one-a-second limit. */
export const geocodePause = () => new Promise((r) => setTimeout(r, 1100));

/** Like geocode, but also returns the place's full name as OpenStreetMap knows it. */
export async function findPlace(text: string): Promise<Place | null> {
  const q = text.trim();
  if (!q) return null;
  try {
    const url = `${NOMINATIM}?${new URLSearchParams({ q, format: "jsonv2", limit: "1" })}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, name: hit.display_name } : null;
  } catch {
    return null;
  }
}

/** Straight-line ("as the crow flies") distance in miles. */
export function milesBetween(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 7917.5 * Math.asin(Math.sqrt(h));
}

export type DrivingRoute = { miles: number; minutes: number; legs: { miles: number; minutes: number }[] };

/**
 * Driving distance and time through `stops` in order, from the public OSRM
 * server (free, no key, best-effort). Null if there's no road route (across an
 * ocean) or the server is unreachable. No live traffic.
 */
export async function drivingRoute(stops: LatLng[]): Promise<DrivingRoute | null> {
  if (stops.length < 2) return null;
  try {
    const coords = stops.map((s) => `${s.lng},${s.lat}`).join(";");
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code: string;
      routes?: { distance: number; duration: number; legs: { distance: number; duration: number }[] }[];
    };
    const best = data.code === "Ok" ? data.routes?.[0] : undefined;
    if (!best) return null;
    const mi = (m: number) => Math.round((m / 1609.34) * 10) / 10;
    const min = (s: number) => Math.round(s / 60);
    return {
      miles: mi(best.distance),
      minutes: min(best.duration),
      legs: best.legs.map((l) => ({ miles: mi(l.distance), minutes: min(l.duration) })),
    };
  } catch {
    return null;
  }
}

/** A Google Maps directions link through `stops` in order (opens the app on a phone). */
export function directionsUrl(stops: LatLng[]): string {
  const at = (s: LatLng) => `${s.lat},${s.lng}`;
  const params = new URLSearchParams({ api: "1", travelmode: "driving", destination: at(stops[stops.length - 1]) });
  if (stops.length > 1) params.set("origin", at(stops[0]));
  if (stops.length > 2) params.set("waypoints", stops.slice(1, -1).map(at).join("|"));
  return `https://www.google.com/maps/dir/?${params}`;
}
