// Plan schema tests (fast, 0 tokens): src/plan.js on sloppy plans and on every saved real / hand-written plan.
// Usage: npm run test:plan
import fs from "node:fs";
import path from "node:path";
import { normalizePlan } from "../src/plan.js";

const results = [];
const check = (name, ok, note = "") => results.push({ case: name, ok: ok ? "PASS" : "FAIL", note: String(note).slice(0, 110) });
const ctx = {
  inputs: [{ n: 1, type: "video", duration: 39 }, { n: 2, type: "image", duration: 3 }],
  recipes: ["promo", "talk", "cinematic"], looks: ["natural", "warm"], moods: ["energetic", "calm"],
  stickers: ["fire", "eyes"], anims: ["words", "highlight", "pop"], transitions: ["cut", "fade", "zoom"],
};

// a cheap model's typical slips: numbers as text, swapped in/out, wrong input, unknown names, missing "#"
const sloppy = {
  recipe: "promo",
  clips: [{ n: "1", s: "2.5", e: "6" }, { n: 1, s: 12, e: 9 }, { n: 3, s: 0, e: 4 }, { n: 1, s: 30, e: 50 }, { n: 1, s: 5, e: 5 }, "oops"],
  texts: [{ t: 0, d: 2.5, text: "  هوک  ", pos: "middle", anim: "spin" }, { t: 3, text: "" }, { t: "x", text: "زمان بد" }],
  marks: [{ type: "sticker", name: "fire", t: 1, x: 0.5, y: 0.3 }, { type: "sticker", name: "unicorn", t: 1, x: 0.5, y: 0.3 }, { type: "laser", t: 1 }, { type: "arrow", t: 2, x: 1.4, y: 0.2 }],
  look: "teal", music: "none", subtitles: "true", emphasis: [0, "1", -2, 7, 8, 9],
  transitions: ["fade", "spiral"], hashtags: ["#بازی", "کوییز فوتبالی", 5], coverFrom: { n: 9 }, cover: "کاور", extra: 1,
};
const { plan, issues } = normalizePlan(sloppy, ctx);
check("numbers as text are read", plan.clips[0].n === 1 && plan.clips[0].s === 2.5 && plan.clips[0].e === 6);
check("swapped in/out swapped back", plan.clips[1].s === 9 && plan.clips[1].e === 12);
check("clip past the end clamped", plan.clips.some((c) => c.s === 30 && c.e === 39));
check("bad clips dropped (wrong input, 0 s, not an object)", plan.clips.length === 3, JSON.stringify(plan.clips));
check("text trimmed, bad pos → top, unknown anim removed", plan.texts[0].text === "هوک" && plan.texts[0].pos === "top" && !plan.texts[0].anim);
check("empty text and bad time dropped", plan.texts.length === 1);
check("unknown sticker / mark type / off-frame arrow dropped", plan.marks.length === 1 && plan.marks[0].name === "fire", JSON.stringify(plan.marks));
check("unknown look dropped, music none kept", plan.look === undefined && plan.music === "none");
check('"true" → true', plan.subtitles === true);
check("emphasis: integers ≥ 0, max 3", JSON.stringify(plan.emphasis) === "[0,1,7]", JSON.stringify(plan.emphasis));
check("unknown transition → recipe's choice", JSON.stringify(plan.transitions) === '["fade",""]');
check("hashtags get # and no spaces", JSON.stringify(plan.hashtags) === '["#بازی","#کوییز_فوتبالی"]', JSON.stringify(plan.hashtags));
check("coverFrom on a missing input dropped", plan.coverFrom === undefined);
check("every repair / drop is reported", issues.length >= 14, `${issues.length} issues`);
check("unknown field reported", issues.some((i) => i.includes("extra")));
check("not an object → empty plan", normalizePlan("hello").plan.clips.length === 0);

// every plan we already have must pass untouched (no false alarms on good plans)
const saved = [];
for (const f of ["data/test-out/arcane-plan.json", "data/test-out/arcane-plan2.json"]) if (fs.existsSync(f)) saved.push([path.basename(f), JSON.parse(fs.readFileSync(f, "utf8")).plan]);
check("saved real plans found", saved.length >= 1, saved.map((s) => s[0]).join(", "));
for (const [name, p] of saved) {
  const r = normalizePlan(p);
  const real = r.issues.filter((i) => !i.startsWith("unknown fields"));
  check(`${name}: no issues`, real.length === 0, real.join(" | "));
  check(`${name}: all clips kept`, r.plan.clips.length === p.clips.length);
}

console.table(results);
process.exit(results.every((r) => r.ok === "PASS") ? 0 : 1);
