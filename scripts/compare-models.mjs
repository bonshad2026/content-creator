// REAL model comparison (P1-5 measurement) — SPENDS GAPGPT TOKENS. Run only when the user asks for it.
// Same saved inputs (known transcripts → no Whisper) through: Opus old prompt, Opus moments mode, a cheaper model in
// moments mode. Each reel is rendered and scored by a rubric fixed BEFORE looking at results (see RUBRIC below).
// Usage: node --env-file=.env scripts/compare-models.mjs [set-filter] [config-filter]
// Output: data/test-out/compare/<set>--<config>.{mp4,-sheet.jpg,-plan.json} + compare/results.json + a table.
import fs from "node:fs";
import path from "node:path";
import { runReel } from "../src/reel.js";
import { styleText, demoMode } from "../src/ai.js";
import { ffmpeg, probe, loudnessOf } from "../src/media.js";

if (demoMode) { console.error("No GAPGPT_API_KEY: run with --env-file=.env"); process.exit(1); }
const FX = path.resolve("data/test-fixtures"), OUT = path.resolve("data/test-out/compare");
fs.mkdirSync(OUT, { recursive: true });

const talkLong = JSON.parse(fs.readFileSync("scripts/fixtures/talk-long-lines.json", "utf8")).map((s) => ({ n: 1, ...s }));
const arcane = JSON.parse(fs.readFileSync("data/test-out/arcane-plan2.json", "utf8"));
const SETS = {
  talk: { files: [["video", "talk-long.mp4"]], transcript: talkLong, brief: "این ویدیو چند توکن خورد؟", speech: [1] },
  mixed: {
    files: [["video", "talk-short.mp4"], ["video", "game.mp4"], ["image", "quiz.jpg"]], brief: "معرفی بازی کوییز جدیدم", speech: [1],
    transcript: [{ n: 1, start: 2.5, end: 3.3, text: "یه بازی جدید ساختم." }, { n: 1, start: 3.3, end: 4.42, text: "ببین دانلود کنین." }],
  },
  film: { files: [["video", "arcane.mp4"]], transcript: arcane.transcript, brief: "ادیت نبرد آخر آرکین", length: 30, speech: [] },
  broll: { files: ["walkway.webm", "vw-t2.webm", "husky.webm", "bird.webm", "cookies.ogv"].map((f) => ["video", `stock/${f}`]), transcript: [], brief: "یه روز آروم", length: 15, speech: [] },
};
const CONFIGS = {
  "opus-old": { AI_MODEL: "claude-opus-5-5", AI_PLAN_MODE: "" },
  "opus-moments": { AI_MODEL: "claude-opus-5-5", AI_PLAN_MODE: "moments" },
  "haiku-moments": { AI_MODEL: "claude-haiku-5-5", AI_PLAN_MODE: "moments" },
};
const profile = styleText({
  platform: "Instagram", niche: "بازی موبایل و کوییز فوتبالی", tone: ["خودمونی", "پرانرژی"], language: "فارسی",
  audience: ["نوجوان", "جوان"], length: "کوتاه", emoji: "کم", hashtags: "چندتا (۳ تا ۵)", cta: "کامنت کن",
});

// RUBRIC (decided before any run): each check is pass/fail, the score is the share passed.
//  length   within ±10 % of the asked length (sets with a length)
//  cover    every video with ≥ 30 s of footage is used in ≥ 3 of its 5 equal time slices
//  hook     a text starts in the first 1.5 s
//  texts    every on-screen text ≤ 5 words
//  subs     speech sets: subtitles on, one sub per speech line
//  clean    the plan needed ≤ 2 repairs
//  sound    -16..-13 LUFS and true peak ≤ -1 dBTP
//  oneshot  one request, not cut off
async function score(set, r, out) {
  const o = r.output, plan = r.plan, checks = {};
  const real = (await probe(out)).duration, ld = await loudnessOf(out);
  if (set.length) checks.length = Math.abs(real - set.length) <= set.length * 0.1;
  const inputs = set.files.map(([type], i) => ({ n: i + 1, type }));
  const cov = [];
  for (const inp of inputs.filter((i) => i.type === "video")) {
    const dur = (await probe(path.join(FX, set.files[inp.n - 1][1]))).duration;
    if (dur < 30) continue;
    const slices = new Set((plan.clips || []).filter((c) => c.n === inp.n).flatMap((c) => [Math.floor((c.s / dur) * 5), Math.floor((Math.min(c.e, dur - 0.01) / dur) * 5)]));
    cov.push(slices.size);
  }
  if (cov.length) checks.cover = cov.every((k) => k >= 3);
  checks.hook = (plan.texts || []).some((t) => (t.t ?? 0) <= 1.5) || (plan.hooks || []).length > 0;
  checks.texts = (plan.texts || []).every((t) => String(t.text).trim().split(/\s+/).length <= 5);
  if (set.speech.length) checks.subs = o.subtitles && Array.isArray(r.rawPlan?.subs) && r.rawPlan.subs.length === set.transcript.length;
  checks.clean = (o.planIssues || []).length <= 2;
  checks.sound = ld.i >= -16 && ld.i <= -13 && ld.tp <= -1;
  const reqs = r.usage.requests || [];
  checks.oneshot = reqs.length === 1 && reqs[0].finish !== "length";
  const passed = Object.values(checks).filter(Boolean).length;
  return {
    checks, score: +(passed / Object.keys(checks).length).toFixed(2), dur: +real.toFixed(1), lufs: ld.i, tp: ld.tp,
    tokens: r.usage.tokens, prompt: reqs.reduce((a, q) => a + (q.prompt || 0), 0), reply: reqs.reduce((a, q) => a + (q.reply || 0), 0),
    cached: reqs.reduce((a, q) => a + (q.cached || 0), 0), cost: r.usage.cost, clips: (plan.clips || []).length, texts: (plan.texts || []).length,
    recipe: o.recipe, issues: o.planIssues || [], coverage: cov,
  };
}

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
console.table(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.error ? { error: v.error.slice(0, 60) } : {
  score: v.score, failed: Object.entries(v.checks).filter(([, ok]) => !ok).map(([c]) => c).join(" "), tokens: v.tokens, prompt: v.prompt, reply: v.reply, cached: v.cached, dur: v.dur, clips: v.clips, issues: v.issues.length,
}])));
