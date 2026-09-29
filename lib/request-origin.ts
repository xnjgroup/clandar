/**
 * The origin (`scheme://host`) a request actually arrived on — how the OAuth
 * redirect URI is built, instead of a value hardcoded to one address.
 *
 * This app is reachable from more than one place at once (localhost while
 * developing, a LAN IP, a Tailscale hostname from a phone), and Google
 * requires the redirect URI to match exactly whichever one the browser used
 * to start the flow. Deriving it from the request means it's always right —
 * but every address this can produce must also be listed as an authorized
 * redirect URI on the Google OAuth client, or Google rejects it with
 * `redirect_uri_mismatch`. `/connectors` shows the current one to add.
 *
 * `x-forwarded-*` wins when present (set by a reverse proxy, including
 * `tailscale serve`) since the plain `Host` header only reflects the proxy's
 * own hop, not what the browser actually requested.
 */
export function originFromHeaders(headers: Headers): string {
  const proto = headers.get("x-forwarded-proto") ?? "http";
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) throw new Error("Request has no Host header — could not determine its origin");
  return `${proto}://${host}`;
}
