/**
 * Address → coordinates, for the schedule map. Uses OpenStreetMap's Nominatim
 * (free, no key). Its usage policy asks for an identifying User-Agent and at
 * most one request a second, so results are stored on the row that needed them
 * and lookups happen one at a time.
 */
export type LatLng = { lat: number; lng: number };

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
