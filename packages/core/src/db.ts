import pg from "pg";
import { config } from "./config";
import { schemaSql } from "./schema";

let pool: pg.Pool | undefined;
let ready: Promise<pg.Pool> | undefined;

// Arbitrary constant: web and worker may start together, the lock keeps schema DDL from racing.
const SCHEMA_LOCK = 7_040_001;

async function applySchema(p: pg.Pool): Promise<pg.Pool> {
  const client = await p.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    await client.query(schemaSql);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]).catch(() => {});
    client.release();
  }
  return p;
}

/** Pool with the schema applied (once per process). */
export function db(): Promise<pg.Pool> {
  if (!ready) {
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    ready = applySchema(pool).catch((err) => {
      ready = undefined;
      throw err;
    });
  }
  return ready;
}

export async function closeDb(): Promise<void> {
  const p = pool;
  pool = undefined;
  ready = undefined;
  await p?.end();
}
