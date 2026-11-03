import { closeDb, config, db, startWorker } from "@cc/core";

await db(); // apply the schema before taking jobs
const worker = startWorker();
worker.on("ready", () => console.log(`worker ready (redis ${config.redisUrl})`));
worker.on("error", (err) => console.error("worker error:", err.message));

async function shutdown() {
  await worker.close();
  await closeDb();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
