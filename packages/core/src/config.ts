import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// The repo root is the nearest package.json with "workspaces"; .env lives there.
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, "utf8")).workspaces) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export const repoRoot = findRepoRoot(process.cwd());

// Values already in process.env win over .env (loadEnvFile never overrides).
const envFile = path.join(repoRoot, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = z
  .object({
    DATABASE_URL: z.string().default("postgres://cc:cc@localhost:5433/content_creator"),
    REDIS_URL: z.string().default("redis://localhost:6380"),
    STORAGE_DIR: z.string().default("storage"),
    MAX_UPLOAD_MB: z.coerce.number().positive().default(20),
  })
  .parse(process.env);

export const config = {
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  storageDir: path.resolve(repoRoot, env.STORAGE_DIR),
  maxUploadBytes: Math.round(env.MAX_UPLOAD_MB * 1024 * 1024),
};
