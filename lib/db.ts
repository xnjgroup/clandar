import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * One pool per process. `next dev` re-evaluates modules on every edit, so the
 * pool is parked on `globalThis` to avoid leaking a connection per reload.
 */
const globalForDb = globalThis as typeof globalThis & { clandarPool?: Pool };

function connectionString() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — copy .env.example to .env.local and point it at your local Postgres.",
    );
  }
  return url;
}

export function pool(): Pool {
  if (!globalForDb.clandarPool) {
    globalForDb.clandarPool = new Pool({
      connectionString: connectionString(),
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return globalForDb.clandarPool;
}

/** Runs a parameterized statement and returns its rows. */
export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool().query<T>(text, params);
  return result.rows;
}

/** Runs a statement expected to match at most one row. */
export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** `numeric` columns arrive as strings; every caller wants a number. */
export function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}
