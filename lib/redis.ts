/**
 * Redis connections backing BullMQ (`lib/queue.ts`, `lib/scheduled-tasks-queue.ts`). Redis only runs
 * background work — Gmail clean-ups, automations, reminders — so losing it must never take the site
 * down. Hence:
 *
 * - `redis()` is the shared connection for the request path (the `Queue` producers, status reads,
 *   pause/cancel flags). It fails fast while Redis is unreachable (no offline queue, one retry) instead
 *   of holding requests open, and keeps reconnecting in the background.
 * - `createRedisConnection()` gives a `Worker` / `QueueEvents` its own connection, as BullMQ asks —
 *   they hold a blocking read open and retry forever (that's in the background, not a request).
 * - `withRedis()` wraps every request-path call: waits briefly for the connection, then gives up
 *   with `QueueUnavailableError` (a 503 in the API) rather than hanging.
 * - Every connection logs its errors (throttled) — an unhandled "error" event would otherwise be
 *   noise at best and a crash at worst.
 *
 * Parked on `globalThis` for the same reason as the Postgres pool in `lib/db.ts`: `next dev`
 * re-evaluates modules on every edit, and a fresh connection per reload would leak.
 */
import IORedis, { type RedisOptions } from "ioredis";

const globalForRedis = globalThis as typeof globalThis & { clandarRedis?: IORedis; clandarRedisLoggedAt?: number };

const url = () => process.env.REDIS_URL ?? "redis://localhost:6379";

/** Reconnect with backoff, capped at 30s — forever, quietly, in the background. */
const retryStrategy = (attempt: number) => Math.min(attempt * 1000, 30_000);

/** One line per minute at most while Redis is down, instead of one per reconnect attempt. */
export function logRedisError(source: string, error: unknown): void {
  const now = Date.now();
  if (now - (globalForRedis.clandarRedisLoggedAt ?? 0) < 60_000) return;
  globalForRedis.clandarRedisLoggedAt = now;
  console.error(`[redis] ${source}: ${error instanceof Error ? error.message : String(error)} (background jobs paused; the site is unaffected)`);
}

function connect(options: RedisOptions, source: string): IORedis {
  const connection = new IORedis(url(), { connectTimeout: 5_000, retryStrategy, ...options });
  connection.on("error", (error) => logRedisError(source, error));
  return connection;
}

export function redis(): IORedis {
  if (!globalForRedis.clandarRedis) {
    globalForRedis.clandarRedis = connect(
      // Fail fast while disconnected: a request gets an error, not a hang.
      { maxRetriesPerRequest: 1, enableOfflineQueue: false },
      "connection",
    );
  }
  return globalForRedis.clandarRedis;
}

export function createRedisConnection(): IORedis {
  // Required by BullMQ for Workers / QueueEvents: it issues blocking commands and controls retries itself.
  return connect({ maxRetriesPerRequest: null }, "worker connection");
}

export class QueueUnavailableError extends Error {
  constructor() {
    super("Background jobs aren't available right now — try again in a minute.");
    this.name = "QueueUnavailableError";
  }
}

/**
 * Runs a request-path Redis call: waits up to `ms` for the connection to be ready (a cold start is
 * still connecting), then for the call itself — and gives up with `QueueUnavailableError` rather than
 * holding the request open while Redis is down.
 */
export async function withRedis<T>(work: () => Promise<T>, ms = 4_000): Promise<T> {
  const connection = redis();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueueUnavailableError()), ms);
  });
  const ready =
    connection.status === "ready"
      ? Promise.resolve()
      : new Promise<void>((resolve) => connection.once("ready", () => resolve()));
  try {
    return await Promise.race([ready.then(work), deadline]);
  } catch (error) {
    if (error instanceof QueueUnavailableError) throw error;
    // A command failing because the connection dropped is the same situation.
    if (connection.status !== "ready") throw new QueueUnavailableError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
