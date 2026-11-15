// Token budget of the ONE planner request per reel, measured on saved inputs WITHOUT sending anything (0 tokens).
// Runs the real analysis (frames, contact sheet, audio class) with a known transcript, captures the exact request
// the planner would send (AI_DRYRUN) and splits it: rulebook sections, creator style, input text, transcript, images.
// Usage: npm run token-budget            → all reel types
//        npm run token-budget -- talk    → only types whose name contains "talk"
// Token counts are ESTIMATES (no tokenizer is available offline): images w×h/750 (Claude's formula, after the
// 1568 px fit); text by script: Latin ~3.8 chars/token, Persian ~1.6 chars/token. Compare with data/usage-log.jsonl
// (the real numbers) after a run the user approves.
import fs from "node:fs";
import path from "node:path";
import { runReel } from "../src/reel.js";
import { styleText } from "../src/ai.js";

const FX = path.resolve("data/test-fixtures"), OUT = path.resolve("data/test-out");
const DRY = path.join(OUT, "dryrun-request.json");
process.env.AI_DRYRUN = DRY;

// the same speech the render tests use (talk-long regions), so no speech-to-text call is needed
const talkLong = JSON.parse(fs.readFileSync(path.resolve("scripts/fixtures/talk-long-lines.json"), "utf8"));
const arcane = fs.existsSync(path.join(OUT, "arcane-plan2.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "arcane-plan2.json"), "utf8")) : null;

const TYPES = {
  "talking head (48 s)": { files: [["video", "talk-long.mp4"]], transcript: talkLong.map((s) => ({ n: 1, ...s })), brief: "این ویدیو چند توکن خورد؟" },
  "screen recording (39 s)": { files: [["video", "game.mp4"]], brief: "معرفی بازی کوییز فوتبالی" },
  "photos only (2)": { files: [["image", "quiz.jpg"], ["image", "quiz.jpg"]], brief: "سوال فوتبالی" },
  "mixed: talk + game + photo": { files: [["video", "talk-short.mp4"], ["video", "game.mp4"], ["image", "quiz.jpg"]], transcript: [{ n: 1, start: 2.5, end: 3.3, text: "یه بازی جدید ساختم." }, { n: 1, start: 3.3, end: 4.42, text: "ببین دانلود کنین." }], brief: "معرفی بازی جدید" },
  "b-roll, 5 stock clips": { files: ["walkway.webm", "vw-t2.webm", "husky.webm", "bird.webm", "cookies.ogv"].map((f) => ["video", `stock/${f}`]), brief: "یه روز آروم" },
  "film, long (290 s → contact sheet)": { files: [["video", "arcane.mp4"]], transcript: arcane?.transcript || [], brief: "ادیت نبرد آخر آرکین، ۶۰ ثانیه" },
};

const profile = styleText({
  platform: "Instagram", niche: "بازی موبایل و کوییز فوتبالی", tone: ["خودمونی", "پرانرژی"], language: "فارسی",
  audience: ["نوجوان", "جوان"], length: "کوتاه", emoji: "کم", hashtags: "چندتا (۳ تا ۵)", cta: "کامنت کن",
});

// ---- estimation ----
const textTokens = (s) => {
  const fa = (s.match(/[؀-ۿ]/g) || []).length;
  return Math.round(fa / 1.6 + (s.length - fa) / 3.8);
};
function jpegSize(b64) {
  const b = Buffer.from(b64, "base64");
  for (let i = 2; i < b.length - 9; ) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
const imageTokens = (b64) => {
  const s = jpegSize(b64);
  if (!s) return 0;
  const k = Math.min(1, 1568 / Math.max(s.w, s.h));
  return Math.round((s.w * k * (s.h * k)) / 750);
};
// the rulebook split into its named parts (first words of each rule paragraph)
function rulebookParts(system) {
  const [rules, style = ""] = system.split("\n\nCREATOR STYLE:\n");
  const parts = {};
  const add = (k, s) => (parts[k] = (parts[k] || 0) + textTokens(s));
  for (const sent of rules.split(/(?<=[.!?])\s+|\n/)) {
    const k = /^Reply ONLY/.test(sent) ? "rules: JSON format"
      : /^marks|"type":"(arrow|bar|sticker|sparkle|confetti|leak)"/.test(sent) ? "rules: marks"
      : /^Text animation|highlight =/.test(sent) ? "rules: text animation"
      : /^Transitions|Fast\/fun|^Look/.test(sent) ? "rules: transitions + look"
      : /narration|subs|mis-heard|speaker's words|No emoji in subs/.test(sent) ? "rules: narration / subs"
      : /^Recipe/.test(sent) ? "rules: recipes"
      : /^Background music/.test(sent) ? "rules: music"
      : /On-screen texts|"top"|text/i.test(sent) ? "rules: on-screen text"
      : "rules: editing (general)";
    add(k, sent);
  }
  parts["creator style"] = textTokens(style);
  return parts;
}

const filter = process.argv[2] || "";
const rows = [];
let lastParts = null;
for (const [name, t] of Object.entries(TYPES)) {
  if (filter && !name.includes(filter)) continue;
  const missing = t.files.find(([, f]) => !fs.existsSync(path.join(FX, f)));
  if (missing) { rows.push({ type: name, note: `skipped: ${missing[1]} missing` }); continue; }
  const id = `_test-budget-${Object.keys(TYPES).indexOf(name)}`;
  const dir = path.resolve("data/jobs", id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const inputs = t.files.map(([type, src], i) => {
    const file = `in${i + 1}${type === "image" ? ".jpg" : path.extname(src)}`;
    fs.copyFileSync(path.join(FX, src), path.join(dir, file));
    return { n: i + 1, type, file };
  });
  fs.rmSync(DRY, { force: true });
  try {
    await runReel({ id, inputs, brief: t.brief }, profile, () => {}, { transcript: t.transcript || [], spokenLang: t.transcript?.length ? "persian" : "" });
  } catch (e) {
    if (!e.dryRun) { rows.push({ type: name, note: e.message.slice(0, 200) }); fs.rmSync(dir, { recursive: true, force: true }); continue; }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  const req = JSON.parse(fs.readFileSync(DRY, "utf8"));
  const parts = rulebookParts(req.system);
  let inputText = 0, transcript = 0, images = 0, nImages = 0;
  for (const c of req.content) {
    if (c.type === "image_url") { images += imageTokens(c.image_url.url.split(",")[1]); nImages++; }
    else if (/^Narration/.test(c.text)) transcript += textTokens(c.text);
    else inputText += textTokens(c.text);
  }
  const rules = Object.entries(parts).filter(([k]) => k.startsWith("rules")).reduce((a, [, v]) => a + v, 0);
  const total = rules + parts["creator style"] + inputText + transcript + images;
  rows.push({ type: name, rules, style: parts["creator style"], "input text": inputText, transcript, images: `${images} (${nImages})`, "prompt total": total });
  fs.writeFileSync(path.join(OUT, `budget-${id}.json`), JSON.stringify({ name, parts, inputText, transcript, images, nImages }, null, 1));
  lastParts = parts;
}
console.table(rows);
if (lastParts) console.table(Object.entries(lastParts).map(([part, tokens]) => ({ part, tokens })).sort((a, b) => b.tokens - a.tokens));
// reply size of the saved real plans (what the model wrote back)
if (arcane) console.log(`reply estimate, Arcane run 2 plan: ${textTokens(JSON.stringify({ ...arcane.plan }))} tokens`);
fs.rmSync(DRY, { force: true });
