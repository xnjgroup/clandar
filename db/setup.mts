/**
 * Creates the database named in DATABASE_URL when it is missing, then applies
 * db/schema.sql. Safe to re-run.
 *
 *   npm run db:setup
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const here = dirname(fileURLToPath(import.meta.url));

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
    process.exit(1);
  }
  return new URL(url);
}

async function ensureDatabase(target: URL) {
  const name = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!name) throw new Error(`DATABASE_URL has no database name: ${target.href}`);

  const admin = new URL(target.href);
  admin.pathname = "/postgres";

  const client = new Client({ connectionString: admin.href });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (rowCount === 0) {
      // Identifiers cannot be parameterized; the name comes from our own URL.
      await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
      console.log(`created database ${name}`);
    } else {
      console.log(`database ${name} already exists`);
    }
  } finally {
    await client.end();
  }
  return name;
}

async function applySchema(target: URL) {
  const sql = await readFile(join(here, "schema.sql"), "utf8");
  const client = new Client({ connectionString: target.href });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'",
    );
    console.log(`schema applied — ${rows[0].count} tables in public`);
  } finally {
    await client.end();
  }
}

const target = databaseUrl();
await ensureDatabase(target);
await applySchema(target);
