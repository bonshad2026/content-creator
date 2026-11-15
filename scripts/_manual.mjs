// One-off: render reels from hand-written edit plans (no AI calls).
import fs from "node:fs";
import path from "node:path";
import { runReel } from "../src/reel.js";

const TALK = "data/jobs/0fHh5AQhw7/in1.mp4", GAME = "data/jobs/7RsGsOQuf-/in2.mp4", PHOTO = "data/jobs/7RsGsOQuf-/in1.jpg";
// the talking clip's speech (timings from the earlier Whisper run)
const talkLines = (n) => [
  { n, start: 2.5, end: 3.3, text: "یه بازی جدید ساختم." },
  { n, start: 3.3, end: 4.42, text: "ببین دانلود کنین." },
];

const edits = {
  // A: energetic quiz challenge — face hook, then question → reveal, question → reveal, last question for the comments
  "A-quiz-challenge": {
    files: [["video", TALK], ["video", GAME]],
    transcript: talkLines(1),
    plan: {
      clips: [{ n: 1, s: 2.2, e: 4.6 }, { n: 2, s: 0.0, e: 2.6 }, { n: 2, s: 7.6, e: 10.6 }, { n: 2, s: 12.0, e: 14.2 }, { n: 2, s: 19.8, e: 22.6 }, { n: 2, s: 24.0, e: 27.0 }, { n: 2, s: 35.6, e: 38.0 }],
      texts: [
        { t: 0, d: 2.3, text: "۳ سوال، ۱۰ ثانیه", pos: "top" },
        { t: 2.5, d: 2.4, text: "سوال اول: بلدی؟", pos: "bottom" },
        { t: 6.4, d: 1.5, text: "زیدان!", pos: "bottom" },
        { t: 8.1, d: 2.0, text: "اینو کی یادشه؟", pos: "bottom" },
        { t: 11.3, d: 1.6, text: "هفت به یک!", pos: "bottom" },
        { t: 16.1, d: 2.3, text: "لینک دانلود تو بیو", pos: "bottom" },
      ],
      subtitles: true, subs: ["یه بازی جدید ساختم.", "ببین دانلود کنین."],
      music: "energetic", look: "pop", brighten: [],
      transitions: ["whip-left", "zoom", "slide-up", "zoom", "flash", "push-left"],
      emphasis: [1], coverFrom: { n: 2, s: 1.0 }, cover: "تو چندتاشو بلدی؟",
    },
  },
  // B: calm, cinematic promo — question photo, the creator, the last question, the end card
  "B-cinematic-promo": {
    files: [["image", PHOTO], ["video", TALK], ["video", GAME]],
    transcript: talkLines(2),
    plan: {
      clips: [{ n: 1, s: 0, e: 2.2 }, { n: 2, s: 2.2, e: 4.7 }, { n: 3, s: 24.0, e: 26.8 }, { n: 3, s: 35.6, e: 38.0 }],
      texts: [
        { t: 0, d: 2.1, text: "اینو بلدی؟", pos: "top" },
        { t: 7.6, d: 2.0, text: "لینک تو بیو", pos: "bottom" },
      ],
      subtitles: true, subs: ["یه بازی جدید ساختم.", "ببین دانلود کنین."],
      music: "none", look: "cinematic", brighten: [],
      transitions: ["blur", "fade", "dip"],
      emphasis: [0], coverFrom: { n: 1, s: 0 }, cover: "سوال سخت فوتبالی",
    },
  },
  // C: fast teaser — only the game, short punchy cuts with glitchy transitions, on the beat
  "C-fast-teaser": {
    files: [["video", GAME]],
    transcript: [],
    plan: {
      clips: [{ n: 1, s: 0.3, e: 1.8 }, { n: 1, s: 9.0, e: 10.4 }, { n: 1, s: 12.3, e: 13.6 }, { n: 1, s: 21.0, e: 22.4 }, { n: 1, s: 24.2, e: 25.8 }, { n: 1, s: 35.6, e: 38.0 }],
      texts: [
        { t: 0, d: 1.5, text: "۱۰ ثانیه وقت داری", pos: "bottom" },
        { t: 1.5, d: 1.3, text: "درست بود؟", pos: "bottom" },
        { t: 2.9, d: 1.3, text: "بعدی!", pos: "bottom" },
        { t: 7.2, d: 2.3, text: "لینک تو بیو", pos: "bottom" },
      ],
      subtitles: false, subs: [],
      music: "energetic", look: "vivid", brighten: [],
      transitions: ["slice", "wind", "pixel", "whip-right", "squeeze"],
      emphasis: [], coverFrom: { n: 1, s: 0.5 }, cover: "۱۰ ثانیه وقت داری",
    },
  },
};

fs.mkdirSync("demo-output", { recursive: true });
for (const [name, e] of Object.entries(edits)) {
  const id = `_m-${name}`;
  const dir = path.resolve("data/jobs", id);
  fs.mkdirSync(dir, { recursive: true });
  const inputs = e.files.map(([type, src], i) => {
    const file = `in${i + 1}.${type === "image" ? "jpg" : "mp4"}`;
    fs.copyFileSync(src, path.join(dir, file));
    return { n: i + 1, type, file };
  });
  const t0 = Date.now();
  const r = await runReel({ id, inputs, brief: "" }, "Niche: بازی کوییز فوتبالی", () => {}, { plan: e.plan, transcript: e.transcript });
  fs.copyFileSync(path.join(dir, "out.mp4"), `demo-output/edit-${name}.mp4`);
  fs.copyFileSync(path.join(dir, "cover.jpg"), `demo-output/edit-${name}-cover.jpg`);
  fs.rmSync(dir, { recursive: true, force: true });
  const o = r.output;
  console.log(name, JSON.stringify({ duration: o.duration, transitions: o.transitions, look: o.look, music: o.music?.mood, jumpCuts: o.jumpCuts, emphasis: o.emphasis }), r.usage, ((Date.now() - t0) / 1000).toFixed(0) + "s");
}
process.exit(0);
