// AI-call helpers, offline (0 tokens): repair of a reply cut off at max_tokens.
// Usage: npm run test:ai
import fs from "node:fs";
import path from "node:path";
import { repairJson } from "../src/ai.js";

const results = [];
const check = (name, ok, note = "") => results.push({ case: name, ok: ok ? "PASS" : "FAIL", note });

check("cut inside a string", repairJson('{"clips":[{"n":1,"s":0,"e":4}],"caption":"hal').clips?.length === 1);
check("cut inside an object", JSON.stringify(repairJson('{"clips":[{"n":1,"s":0,"e":4},{"n":1,"s":6')?.clips) === '[{"n":1,"s":0,"e":4}]');
check("cut after a comma", repairJson('```json\n{"a":1,"b":[1,2],').b?.length === 2);
check("complete reply unchanged", repairJson('{"a":{"b":"x}"}}').a?.b === "x}");
check("nothing usable → null", repairJson('{"a') === null);

// a real plan cut at every 10th character: the repair must never throw, and the clips survive once written
const real = path.resolve("data/test-out/arcane-plan2.json");
if (fs.existsSync(real)) {
  const full = JSON.stringify(JSON.parse(fs.readFileSync(real, "utf8")).plan);
  const clipsEnd = full.indexOf("]", full.indexOf('"clips"')) + 1;
  let bad = 0;
  for (let k = 20; k < full.length; k += 10) {
    const r = repairJson(full.slice(0, k));
    if (k > clipsEnd + 1 && r?.clips?.length !== 16) bad++;
  }
  check("real plan cut at every 10th char", bad === 0, `${bad} cuts lost the clips`);
}

console.table(results);
process.exit(results.every((r) => r.ok === "PASS") ? 0 : 1);
