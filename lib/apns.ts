/**
 * iPhone push (Apple Push Notification service), via the `apns2` package with a token-based (.p8) key.
 * The iOS app registers its device token (device_tokens); pushToPerson sends here alongside Web Push.
 * Needs APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY (the .p8 contents; "\n"-escaped is fine) —
 * without them iPhone push is simply off. The topic is the app's bundle id (APPLE_BUNDLE_ID).
 */
import { ApnsClient, ApnsError, Errors, Notification } from "apns2";
import { query } from "@/lib/db";

type Environment = "sandbox" | "production";

const globalForApns = globalThis as unknown as { clandarApns?: Partial<Record<Environment, ApnsClient>> };

export function apnsConfigured(): boolean {
  return Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY);
}

function client(environment: Environment): ApnsClient {
  const clients = (globalForApns.clandarApns ??= {});
  return (clients[environment] ??= new ApnsClient({
    team: process.env.APNS_TEAM_ID!,
    keyId: process.env.APNS_KEY_ID!,
    signingKey: process.env.APNS_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    defaultTopic: process.env.APPLE_BUNDLE_ID || "com.clandar.app",
    host: environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com",
  }));
}

export async function saveDeviceToken(personId: string, token: string, environment: Environment): Promise<void> {
  await query(
    `INSERT INTO device_tokens (person_id, token, environment) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET person_id = excluded.person_id, environment = excluded.environment, last_seen_at = now()`,
    [personId, token, environment],
  );
}

export async function deleteDeviceToken(personId: string, token: string): Promise<void> {
  await query(`DELETE FROM device_tokens WHERE person_id = $1 AND token = $2`, [personId, token]);
}

/** Sends to every iPhone the person is signed in on; tokens Apple reports as dead are removed. */
export async function pushToDevices(personId: string, payload: { title: string; body: string; link?: string | null }) {
  if (!apnsConfigured()) return;
  const devices = await query<{ token: string; environment: Environment }>(
    `SELECT token, environment FROM device_tokens WHERE person_id = $1`,
    [personId],
  );
  await Promise.all(
    devices.map(async (d) => {
      try {
        await client(d.environment).send(
          new Notification(d.token, {
            alert: { title: payload.title, body: payload.body },
            sound: "default",
            data: payload.link ? { link: payload.link } : undefined,
          }),
        );
      } catch (error) {
        const reason = error instanceof ApnsError ? error.reason : null;
        if (reason === Errors.unregistered || reason === Errors.badDeviceToken || reason === Errors.deviceTokenNotForTopic) {
          await query(`DELETE FROM device_tokens WHERE token = $1`, [d.token]);
        } else {
          console.error("[apns] send failed:", reason ?? (error instanceof Error ? error.message : error));
        }
      }
    }),
  );
}
