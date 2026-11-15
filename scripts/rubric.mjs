// The comparison rubric (P1-5), shared by compare-models.mjs (real runs) and rescore.mjs (saved runs, 0 tokens).
// Each check is pass/fail; the score is the share passed. Checks only apply where they make sense (see each).
//  length   within ±10 % of the asked length (sets with a length)
//  cover    every video with ≥ 30 s of footage is spread over min(3, its clip count) of its 5 equal time slices
//           (was "≥ 3 slices": a 15 s reel with one clip of a 47 s video could never pass)
//  hook     a text starts in the first 1.5 s
//  texts    every on-screen text ≤ 5 words
//  subs     speech sets: subtitles on, one sub per speech line
//  clean    the plan needed ≤ 2 repairs
//  sound    -16..-13 LUFS and true peak ≤ -1 dBTP
//  oneshot  one request, not cut off
//  ending   the last shot is not an empty screen (dark AND featureless at its last frame)
//  reveal   quiz: an answer reveal (highlight text or ✅) exists and comes after the first question (a text with ?/؟).
//           A spoiler INSIDE the footage (answer already highlighted in a game frame) is not visible to this check.
//  accents  quiz: a timer bar, a reveal and a sticker; promo: at least 2 marks / stickers
import fs from "node:fs";
import path from "node:path";
import { probe, loudnessOf, bandStats } from "../src/media.js";

export const FX = path.resolve("data/test-fixtures");
const talkLong = JSON.parse(fs.readFileSync("scripts/fixtures/talk-long-lines.json", "utf8")).map((s) => ({ n: 1, ...s }));
const arcaneFile = "data/test-out/arcane-plan2.json";
const arcane = fs.existsSync(arcaneFile) ? JSON.parse(fs.readFileSync(arcaneFile, "utf8")) : { transcript: [] };
export const SETS = {
  talk: { files: [["video", "talk-long.mp4"]], transcript: talkLong, brief: "این ویدیو چند توکن خورد؟", speech: [1] },
  mixed: {
    files: [["video", "talk-short.mp4"], ["video", "game.mp4"], ["image", "quiz.jpg"]], brief: "معرفی بازی کوییز جدیدم", speech: [1],
    transcript: [{ n: 1, start: 2.5, end: 3.3, text: "یه بازی جدید ساختم." }, { n: 1, start: 3.3, end: 4.42, text: "ببین دانلود کنین." }],
  },
  film: { files: [["video", "arcane.mp4"]], transcript: arcane.transcript, brief: "ادیت نبرد آخر آرکین", length: 30, speech: [] },
  broll: { files: ["walkway.webm", "vw-t2.webm", "husky.webm", "bird.webm", "cookies.ogv"].map((f) => ["video", `stock/${f}`]), transcript: [], brief: "یه روز آروم", length: 15, speech: [] },
};

// an "empty" frame: dark and almost without edges (calibrated on the saved runs: the empty game end screen is
// luma 16 / edges 1.4; the plainest good ending, a talking head on a light wall, is luma 137 / edges 2.3)
export const EMPTY = { luma: 40, edges: 3 };
const QUESTION = /[?؟]/;

/** r = {plan, rawPlan, output, usage} (a fresh run, or a saved -plan.json as {plan, raw, output, usage}); out = the rendered reel. */
export async function score(set, r, out) {
  const o = r.output, plan = r.plan, raw = r.rawPlan ?? r.raw, checks = {};
  const real = (await probe(out)).duration, ld = await loudnessOf(out);
  const clips = plan.clips || [], texts = plan.texts || [], marks = plan.marks || [];
  if (set.length) checks.length = Math.abs(real - set.length) <= set.length * 0.1;
  const cov = [];
  for (const [i, [type, file]] of set.files.entries()) {
    if (type !== "video") continue;
    const dur = (await probe(path.join(FX, file))).duration;
    const own = clips.filter((c) => c.n === i + 1);
    if (dur < 30 || !own.length) continue;
    const slices = new Set(own.flatMap((c) => [Math.floor((c.s / dur) * 5), Math.floor((Math.min(c.e, dur - 0.01) / dur) * 5)]));
    cov.push({ used: slices.size, need: Math.min(3, own.length) });
  }
  if (cov.length) checks.cover = cov.every((c) => c.used >= c.need);
  checks.hook = texts.some((t) => (t.t ?? 0) <= 1.5) || (plan.hooks || []).length > 0;
  checks.texts = texts.every((t) => String(t.text).trim().split(/\s+/).length <= 5);
  if (set.speech.length) checks.subs = !!o.subtitles && Array.isArray(raw?.subs) && raw.subs.length === set.transcript.length;
  checks.clean = (o.planIssues || []).length <= 2;
  checks.sound = ld.i >= -16 && ld.i <= -13 && ld.tp <= -1;
  const reqs = r.usage.requests || [];
  checks.oneshot = reqs.length === 1 && reqs[0].finish !== "length";

  let end = null;
  const last = clips[clips.length - 1];
  if (last) {
    const [type, file] = set.files[last.n - 1];
    end = await bandStats(path.join(FX, file), last.e - 0.3, 0, 1, type === "image");
    checks.ending = !(end.luma < EMPTY.luma && end.edges < EMPTY.edges);
  }
  const reveals = [...texts.filter((t) => t.anim === "highlight"), ...marks.filter((m) => m.name === "check")].map((x) => x.t ?? 0);
  const firstQ = texts.filter((t) => QUESTION.test(t.text)).map((t) => t.t ?? 0).sort((a, b) => a - b)[0];
  if (o.recipe === "quiz") {
    checks.reveal = reveals.length > 0 && firstQ != null && Math.min(...reveals) > firstQ;
    checks.accents = marks.some((m) => m.type === "bar") && reveals.length > 0 && marks.some((m) => m.type === "sticker");
  }
  if (o.recipe === "promo") checks.accents = marks.length >= 2;

  const passed = Object.values(checks).filter(Boolean).length;
  return {
    checks, score: +(passed / Object.keys(checks).length).toFixed(2), dur: +real.toFixed(1), lufs: ld.i, tp: ld.tp,
    tokens: r.usage.tokens, prompt: reqs.reduce((a, q) => a + (q.prompt || 0), 0), reply: reqs.reduce((a, q) => a + (q.reply || 0), 0),
    cached: reqs.reduce((a, q) => a + (q.cached || 0), 0), cost: r.usage.cost, clips: clips.length, texts: texts.length, marks: marks.length,
    recipe: o.recipe, issues: o.planIssues || [], coverage: cov, end: end && { luma: +end.luma.toFixed(1), edges: +end.edges.toFixed(2) },
  };
}

/** One row per run for console.table. */
export const row = (v) => v.error ? { error: v.error.slice(0, 60) } : {
  score: v.score, failed: Object.entries(v.checks).filter(([, ok]) => !ok).map(([c]) => c).join(" "), recipe: v.recipe, tokens: v.tokens,
  prompt: v.prompt, reply: v.reply, cached: v.cached, dur: v.dur, clips: v.clips, marks: v.marks, issues: v.issues.length,
};
