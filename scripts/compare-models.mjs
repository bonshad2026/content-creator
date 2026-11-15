// REAL model comparison (P1-5 measurement) — SPENDS GAPGPT TOKENS. Run only when the user asks for it.
// Same saved inputs (known transcripts → no Whisper) through: Opus old prompt, Opus moments mode, a cheaper model in
// moments mode. Each reel is rendered and scored by the rubric in rubric.mjs.
// Usage: node --env-file=.env scripts/compare-models.mjs [set-filter] [config-filter]
// Output: data/test-out/compare/<set>--<config>.{mp4,-sheet.jpg,-plan.json} + compare/results.json + a table.
import fs from "node:fs";
import path from "node:path";
import { runReel } from "../src/reel.js";
import { styleText, demoMode } from "../src/ai.js";
import { ffmpeg } from "../src/media.js";
import { SETS, FX, score, row } from "./rubric.mjs"; // the rubric (and the input sets) live in rubric.mjs

if (demoMode) { console.error("No GAPGPT_API_KEY: run with --env-file=.env"); process.exit(1); }
const OUT = path.resolve("data/test-out/compare");
fs.mkdirSync(OUT, { recursive: true });

const CONFIGS = {
  "opus-old": { AI_MODEL: "claude-opus-5-5", AI_PLAN_MODE: "" },
  "opus-moments": { AI_MODEL: "claude-opus-5-5", AI_PLAN_MODE: "moments" },
  "haiku-moments": { AI_MODEL: "claude-haiku-5-5", AI_PLAN_MODE: "moments" },
};
const profile = styleText({
  platform: "Instagram", niche: "بازی موبایل و کوییز فوتبالی", tone: ["خودمونی", "پرانرژی"], language: "فارسی",
  audience: ["نوجوان", "جوان"], length: "کوتاه", emoji: "کم", hashtags: "چندتا (۳ تا ۵)", cta: "کامنت کن",
});

const [setF = "", cfgF = ""] = process.argv.slice(2);
const resultsFile = path.join(OUT, "results.json");
const results = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, "utf8")) : {};
for (const [sname, set] of Object.entries(SETS)) {
  if (setF && !sname.includes(setF)) continue;
  for (const [cname, env] of Object.entries(CONFIGS)) {
    if (cfgF && !cname.includes(cfgF)) continue;
    const key = `${sname}--${cname}`;
    Object.assign(process.env, env);
    const id = `_test-compare-${key}`, dir = path.resolve("data/jobs", id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const inputs = set.files.map(([type, src], i) => {
      const file = `in${i + 1}${type === "image" ? ".jpg" : path.extname(src)}`;
      fs.copyFileSync(path.join(FX, src), path.join(dir, file));
      return { n: i + 1, type, file };
    });
    const t0 = Date.now();
    try {
      // manual WITHOUT a plan: known transcript (no Whisper), real planner request
      const r = await runReel({ id, inputs, brief: set.brief, length: set.length }, profile, () => {}, { transcript: set.transcript, spokenLang: set.transcript.length ? "persian" : "" });
      const out = path.join(OUT, `${key}.mp4`);
      fs.copyFileSync(path.join(dir, "out.mp4"), out);
      await ffmpeg(["-i", out, "-vf", "fps=1,scale=150:-2,tile=8x4", "-frames:v", "1", path.join(OUT, `${key}-sheet.jpg`)]).catch(() => {});
      fs.writeFileSync(path.join(OUT, `${key}-plan.json`), JSON.stringify({ raw: r.rawPlan, plan: r.plan, output: r.output, usage: r.usage }, null, 1));
      results[key] = { ...(await score(set, r, out)), sec: Math.round((Date.now() - t0) / 1000) };
    } catch (e) {
      results[key] = { error: e.message.slice(0, 300) };
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 1));
    console.log(key, JSON.stringify(results[key]).slice(0, 400));
  }
}
console.table(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, row(v)])));
