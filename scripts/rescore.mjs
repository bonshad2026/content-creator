// Re-score the saved comparison runs with the current rubric. 0 tokens: reads data/test-out/compare/*-plan.json + .mp4.
// Usage: node scripts/rescore.mjs   (writes compare/rescore.json; results.json from the real runs is left alone)
import fs from "node:fs";
import path from "node:path";
import { SETS, score, row } from "./rubric.mjs";

const OUT = path.resolve("data/test-out/compare");
const results = {};
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith("-plan.json")).sort()) {
  const key = f.replace(/-plan\.json$/, ""), set = SETS[key.split("--")[0]];
  if (!set) continue;
  try {
    results[key] = await score(set, JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")), path.join(OUT, `${key}.mp4`));
  } catch (e) {
    results[key] = { error: e.message.slice(0, 300) };
  }
}
fs.writeFileSync(path.join(OUT, "rescore.json"), JSON.stringify(results, null, 1));
console.table(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, row(v)])));
