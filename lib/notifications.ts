/** In-app notifications behind the header bell — one row per recipient, marked read when opened. */
import { query, queryOne } from "@/lib/db";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: Date;
};

export async function createNotification(input: {
  orgId: string;
  personId: string;
  title: string;
  body: string;
  link: string | null;
}): Promise<void> {
  await query(`INSERT INTO notifications (org_id, person_id, title, body, link) VALUES ($1, $2, $3, $4, $5)`, [
    input.orgId,
    input.personId,
    input.title.slice(0, 200),
    input.body.slice(0, 1000),
    input.link,
  ]);
}

export async function listNotifications(personId: string, limit = 20): Promise<{ items: AppNotification[]; unread: number }> {
  const [rows, count] = await Promise.all([
    query<{ id: string; title: string; body: string; link: string | null; read_at: Date | null; created_at: Date }>(
      `SELECT id, title, body, link, read_at, created_at FROM notifications
        WHERE person_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [personId, limit],
    ),
    queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE person_id = $1 AND read_at IS NULL`, [
      personId,
    ]),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      link: r.link,
      read: r.read_at !== null,
      createdAt: r.created_at,
    })),
    unread: count?.n ?? 0,
  };
}

/** Marks one notification read, or all of the person's when `id` is omitted. */
export async function markNotificationsRead(personId: string, id?: string): Promise<void> {
  if (id) {
    await query(`UPDATE notifications SET read_at = now() WHERE id = $1 AND person_id = $2 AND read_at IS NULL`, [
      id,
      personId,
    ]);
  } else {
    await query(`UPDATE notifications SET read_at = now() WHERE person_id = $1 AND read_at IS NULL`, [personId]);
  }
}
