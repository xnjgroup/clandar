/**
 * Redis connections backing BullMQ (`lib/queue.ts`). `redis()` is a shared,
 * process-wide connection for lightweight, non-blocking use (the `Queue`
 * producer, one-off status reads). `createRedisConnection()` hands out a
 * fresh dedicated one for anything BullMQ recommends *not* share a connection
 * — a `Worker` and `QueueEvents` both hold a connection open for blocking
 * reads, and sharing that with other traffic risks one starving the other.
 *
 * Parked on `globalThis` for the same reason as the Postgres pool in
 * `lib/db.ts`: `next dev` re-evaluates modules on every edit, and a fresh
 * connection per reload would leak.
 */
import IORedis from "ioredis";

const globalForRedis = globalThis as typeof globalThis & { clandarRedis?: IORedis };

function connectionOptions() {
  return {
    // Required by BullMQ: it issues its own blocking commands and expects to
    // control retry behavior rather than have ioredis retry underneath it.
    maxRetriesPerRequest: null as null,
  };
}

export function redis(): IORedis {
  if (!globalForRedis.clandarRedis) {
    globalForRedis.clandarRedis = new IORedis(
      process.env.REDIS_URL ?? "redis://localhost:6379",
      connectionOptions(),
    );
  }
  return globalForRedis.clandarRedis;
}

export function createRedisConnection(): IORedis {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", connectionOptions());
}
