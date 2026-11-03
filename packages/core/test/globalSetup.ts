import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

// Fresh test database and storage folder per run.
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://cc:cc@localhost:5433/content_creator_test");
  const name = url.pathname.slice(1);
  if (!name.endsWith("_test")) throw new Error(`refusing to recreate non-test database "${name}"`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${name}"`);
  await client.end();
  await fs.rm(path.resolve(import.meta.dirname, "../../../storage-test"), { recursive: true, force: true });
}
