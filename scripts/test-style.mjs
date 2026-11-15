// Style checks (fast, 0 tokens): the "busy footage behind cinematic text" decision on known frames.
// Usage: npm run test:style
import fs from "node:fs";
import path from "node:path";
import { bandStats, BACKDROP, TEXT_BAND, buildAss } from "../src/media.js";

const FX = path.resolve("data/test-fixtures");
const results = [];
const check = (name, ok, note = "") => results.push({ case: name, ok: ok ? "PASS" : "FAIL", note });
const busy = (s) => s.edges > BACKDROP.edges || s.luma > BACKDROP.luma;

// [file, time, band, expected]: looked at by eye — fight / city / foliage are busy; a dark calm shot and a face are not
const FRAMES = [
  ["arcane.mp4", 52, "Center", true],
  ["arcane.mp4", 162, "Center", true],
  ["arcane.mp4", 254, "Top", false],
  ["talk-long.mp4", 3, "Top", false],
  ["tos-scene.mp4", 15, "Sub", true],
];
for (const [f, t, band, want] of FRAMES) {
  if (!fs.existsSync(path.join(FX, f))) { check(`${f}@${t}`, true, "skipped"); continue; }
  const [a, b] = TEXT_BAND[band];
  const s = await bandStats(path.join(FX, f), t, a - 0.03, b + 0.03);
  check(`${f}@${t} ${band} → ${want ? "busy" : "calm"}`, busy(s) === want, `edges ${s.edges.toFixed(1)} luma ${s.luma.toFixed(0)}`);
}

// the band is drawn only for minimal (cinematic) styles, and only behind texts marked busy
const t = { start: 0, end: 2, text: "متن", style: "Top", anim: "fade" };
const bands = (ass) => ass.split("\n").filter((l) => l.includes("\\p1}m 0")).length;
check("busy cinematic text gets a band", bands(buildAss({ minimal: true, texts: [{ ...t, backdrop: true }] })) === 1);
check("calm cinematic text gets none", bands(buildAss({ minimal: true, texts: [t] })) === 0);
check("bold styles never get one", bands(buildAss({ texts: [{ ...t, backdrop: true }] })) === 0);
check("busy subtitle gets a band", bands(buildAss({ minimal: true, subs: [{ start: 0, end: 2, text: "سلام", words: [], backdrop: true }] })) === 1);

console.table(results);
process.exit(results.every((r) => r.ok === "PASS") ? 0 : 1);
