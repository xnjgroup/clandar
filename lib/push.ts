/**
 * Browser push (Web Push, via the `web-push` package — the approach in Next's
 * PWA guide). A person enables it per browser from the notification bell;
 * each subscription is stored here and gets every notification sent to them.
 * With no VAPID keys configured, push is simply off.
 */
import webpush from "web-push";
import { query } from "@/lib/db";

let configured: boolean | null = null;

export function pushConfigured(): boolean {
  if (configured === null) {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    configured = Boolean(publicKey && privateKey);
    if (configured) {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", publicKey!, privateKey!);
    }
  }
  return configured;
}

export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function savePushSubscription(personId: string, sub: PushSubscriptionJson): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (person_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET person_id = excluded.person_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [personId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
  );
}

export async function deletePushSubscription(personId: string, endpoint: string): Promise<void> {
  await query(`DELETE FROM push_subscriptions WHERE person_id = $1 AND endpoint = $2`, [personId, endpoint]);
}

/** Pushes to every browser the person enabled; subscriptions the push service reports as gone are removed. */
export async function pushToPerson(personId: string, payload: { title: string; body: string; link?: string | null }) {
  if (!pushConfigured()) return;
  const subs = await query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE person_id = $1`,
    [personId],
  );
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 12 },
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [s.endpoint]);
        }
      }
    }),
  );
}
