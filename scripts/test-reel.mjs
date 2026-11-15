// Offline capability tests for the reel editor: hand-written edit plans, NO GapGPT / Whisper calls (0 tokens).
// Usage: npm run test:reel            → all cases
//        npm run test:reel -- looks   → only cases whose name contains "looks"
// Inputs: data/test-fixtures/ (talk-short.mp4, talk-long.mp4, game.mp4, quiz.jpg, silent.mp4, landscape.mp4)
// Output: data/test-out/<case>.mp4 + <case>-sheet.jpg (1 frame per second) + a pass/fail table.
import fs from "node:fs";
import path from "node:path";
import { runReel } from "../src/reel.js";
import { ffmpeg, ffmpegScan, probe, renderCover, buildAss, loudnessOf, LOOKS, TRANSITIONS } from "../src/media.js";

const FX = path.resolve("data/test-fixtures"), OUT = path.resolve("data/test-out");
fs.mkdirSync(OUT, { recursive: true });

// ---- known speech (so no speech-to-text call is needed) ----
const talkShort = (n) => [
  { n, start: 2.5, end: 3.3, text: "یه بازی جدید ساختم." },
  { n, start: 3.3, end: 4.42, text: "ببین دانلود کنین." },
];
// long talk: real sentences, times spread over the speech regions (measured with silencedetect)
function talkLong(n, maxT = Infinity) {
  const regions = [
    [0.5, 16.76, ["من می‌خوام آزمایش کنم.", "ببینم این ویدیویی که دارم می‌سازم چه مقدار مصرف توکن داره.", "الان ویدیو تقریبا ۱۰ ثانیه ازش گذشته.", "اما من می‌خوام به مدت ۲۰ ثانیه دیگه ادامه بدم.", "ویدیو در واقع تبدیل بشه به یه ویدیوی ۳۰ ثانیه‌ای."]],
    [17.76, 22.16, ["الان ۱۰ ثانیه دیگه مونده."]],
    [22.96, 29.29, ["تقریبا ۵ ثانیه بعد از اون دیگه تمومه."]],
    [30.36, 36.35, ["خب، حالا بذار ببینم اگه که ۳۰ ثانیه دیگه هم ادامه بدم."]],
    [37.13, 42.37, ["این چقدر می‌تونه توی هزینه من برای ادیت یک ویدیو تأثیر بذاره؟"]],
    [44.09, 47.28, ["الان شد ۴۵ ثانیه، ولش کن تا همین‌جا بسه."]],
  ];
  const out = [];
  for (const [a, b, lines] of regions) {
    const total = lines.reduce((x, l) => x + l.length, 0);
    let t = a;
    for (const l of lines) {
      const d = ((b - a) * l.length) / total;
      if (t + d <= maxT) out.push({ n, start: t, end: t + d, text: l });
      t += d;
    }
  }
  return out;
}

// Tears of Steel (CC-BY, Blender Foundation) opening dialogue, cut at 22.5 s: English speech + the human Persian subtitles
// → tests "speech in another language → Persian karaoke subtitles" without any speech-to-text call
function tosLines(n) {
  const dir = path.join(FX, "tos");
  if (!fs.existsSync(path.join(dir, "TOS-en.srt"))) return { transcript: [], subs: [] };
  const parse = (f) => fs.readFileSync(path.join(dir, f), "utf8").replace(/\r/g, "").trim().split(/\n\n+/).map((b) => {
    const l = b.split("\n"), m = l[1]?.match(/(\d+):(\d+):(\d+)[,.](\d+) --> (\d+):(\d+):(\d+)[,.](\d+)/);
    if (!m) return null;
    const t = (h, mi, s, ms) => +h * 3600 + +mi * 60 + +s + +ms / 1000;
    return { s: t(m[1], m[2], m[3], m[4]), e: t(m[5], m[6], m[7], m[8]), text: l.slice(2).join(" ").trim() };
  }).filter(Boolean);
  const en = parse("TOS-en.srt").filter((x) => x.s >= 22.5 && x.e <= 46), fa = parse("TOS-Persian.srt");
  // the Persian file has its sentence punctuation at the start (".تو یه احمقی") → move it to the end
  const fixFa = (s) => { const m = s.match(/^([.!?؟…،,\s]+)(.*)$/); return m ? `${m[2]}${m[1].replace(/\s/g, "")}` : s; };
  const transcript = en.map((x) => ({ n, start: x.s - 22.5, end: x.e - 22.5, text: x.text.replace(/"[^"]*"\s*/g, "") }));
  const subs = en.map((x) => fixFa((fa.find((y) => Math.abs(y.s - x.s) < 1.2) || { text: x.text }).text));
  return { transcript, subs };
}

// game recording timeline: Q1 0-9 (answer at 9.0), Q2 12-22 (answer at 21.0), Q3 24-35 (no answer), end card 35.5-38
const CASES = {
  // jump cuts on real pauses, karaoke subtitles, emphasis zoom on the face, warm look, music ducking under the voice
  "talk-jumpcuts-karaoke": {
    files: [["video", "talk-long.mp4"]],
    transcript: talkLong(1),
    plan: {
      clips: [{ n: 1, s: 0.3, e: 16.8 }, { n: 1, s: 17.6, e: 29.4 }, { n: 1, s: 30.2, e: 47.4 }],
      texts: [{ t: 0, d: 2.5, text: "این ویدیو چند توکن خورد؟", pos: "top" }],
      subtitles: true, subs: talkLong(1).map((s) => s.text), music: "energetic", look: "warm",
      transitions: ["cut", "cut"], emphasis: [1, 8], coverFrom: { n: 1, s: 3 }, cover: "چند توکن خورد؟",
    },
  },
  // only photos: Ken Burns zoom, texts in the free top band, slide transition, music only (no voice → loud music)
  "photos-only": {
    files: [["image", "quiz.jpg"], ["image", "quiz.jpg"]],
    plan: {
      clips: [{ n: 1, s: 0, e: 3 }, { n: 2, s: 0, e: 3 }],
      texts: [{ t: 0, d: 2.8, text: "اینو بلدی؟", pos: "top" }, { t: 3, d: 2.8, text: "جوابو کامنت کن", pos: "center" }],
      subtitles: false, music: "energetic", look: "natural", transitions: ["slide-left"], coverFrom: { n: 1 }, cover: "سوال فوتبالی",
    },
  },
  // every transition once (17 joins between short game clips), no music, bottom texts on the game screen
  "all-transitions": {
    files: [["video", "game.mp4"], ["image", "quiz.jpg"]],
    plan: (() => {
      const names = Object.keys(TRANSITIONS).filter((t) => t !== "cut");
      const clips = [];
      for (let i = 0; i <= names.length; i++) clips.push(i % 3 === 2 ? { n: 2, s: 0, e: 1.6 } : { n: 1, s: (i * 2.1) % 34, e: ((i * 2.1) % 34) + 1.6 });
      return {
        clips, texts: names.map((name, i) => ({ t: i * 1.6 + 1.2, d: 1.0, text: name, pos: "bottom" })),
        subtitles: false, music: "none", look: "natural", transitions: names, coverFrom: { n: 1, s: 1 }, cover: "ترنزیشن‌ها",
      };
    })(),
  },
  // landscape video with a face → smart 9:16 crop following the face + punch-in; then game; cinematic look
  "landscape-smartcrop": {
    files: [["video", "landscape.mp4"], ["video", "game.mp4"]],
    transcript: talkLong(1, 19.9),
    plan: {
      clips: [{ n: 1, s: 0.3, e: 9.5 }, { n: 2, s: 24, e: 27 }],
      texts: [{ t: 0, d: 2.5, text: "کراپ هوشمند", pos: "top" }, { t: 9.5, d: 2.5, text: "لینک تو بیو", pos: "bottom" }],
      subtitles: true, subs: talkLong(1, 19.9).map((s) => s.text), music: "none", look: "cinematic",
      transitions: ["whip-left"], emphasis: [1], coverFrom: { n: 1, s: 4 }, cover: "کراپ هوشمند",
    },
  },
  // face hook + game, all three text positions, brighten on the dark game footage, pop look, flash + zoom transitions
  "mix-positions-brighten": {
    files: [["video", "talk-short.mp4"], ["video", "game.mp4"]],
    transcript: talkShort(1),
    plan: {
      clips: [{ n: 1, s: 2.2, e: 4.6 }, { n: 2, s: 7.6, e: 10.6 }, { n: 2, s: 19.8, e: 22.6 }],
      texts: [
        { t: 0, d: 2.3, text: "۳ سوال، ۱۰ ثانیه", pos: "top" },
        { t: 3.6, d: 1.4, text: "زیدان!", pos: "bottom" },
        { t: 6.2, d: 1.6, text: "هفت به یک!", pos: "center" },
      ],
      subtitles: true, subs: ["یه بازی جدید ساختم.", "ببین دانلود کنین."], music: "energetic", look: "pop", brighten: [2],
      transitions: ["zoom", "flash"], emphasis: [1], coverFrom: { n: 2, s: 1 }, cover: "تو چندتاشو بلدی؟",
    },
  },
  // level-1 motion graphics: all 8 text animations + countdown bar, circle on the photo, arrow on the game's answer
  "motion-graphics": {
    files: [["video", "talk-short.mp4"], ["video", "game.mp4"], ["image", "quiz.jpg"]],
    transcript: talkShort(1),
    plan: {
      clips: [{ n: 1, s: 2.2, e: 4.6 }, { n: 3, s: 0, e: 4 }, { n: 2, s: 0.0, e: 3.5 }, { n: 2, s: 7.8, e: 10.6 }, { n: 2, s: 35.6, e: 38.0 }],
      texts: [
        { t: 0, d: 2.3, text: "سوال فوتبالی داریم", pos: "top", anim: "words" },
        { t: 2.5, d: 1.8, text: "اینو بلدی؟", pos: "top", anim: "slide-up" },
        { t: 4.4, d: 1.9, text: "۱۰ ثانیه وقت داری", pos: "top", anim: "bounce" },
        { t: 6.5, d: 1.6, text: "سوال اول", pos: "bottom", anim: "slide-right" },
        { t: 8.2, d: 1.6, text: "سخت بود؟", pos: "bottom", anim: "wipe" },
        { t: 11.1, d: 1.6, text: "زیدان", pos: "bottom", anim: "highlight" },
        { t: 12.8, d: 2.2, text: "لینک تو بیو", pos: "bottom", anim: "shake" },
        { t: 13.6, d: 1.4, text: "دنبال کن", pos: "center", anim: "pop" },
      ],
      marks: [
        { type: "bar", t: 2.4, d: 4.0, y: 0.965 },
        { type: "circle", t: 4.6, d: 1.8, n: 3, x: 0.5, y: 0.525, r: 0.17 },
        { type: "arrow", t: 10.9, d: 1.8, n: 2, x: 0.8, y: 0.62 },
      ],
      subtitles: true, subs: ["یه بازی جدید ساختم.", "ببین دانلود کنین."], music: "energetic", look: "vivid",
      transitions: ["whip-left", "zoom", "flash", "dip"], coverFrom: { n: 3 }, cover: "اینو بلدی؟",
    },
  },
  // level-2 overlays: emoji stickers (bounce in), light leaks (warm intro, pink over a transition), burst + sparkle + confetti on the reveal
  "overlays": {
    files: [["video", "talk-short.mp4"], ["video", "game.mp4"], ["image", "quiz.jpg"]],
    transcript: talkShort(1),
    plan: {
      clips: [{ n: 1, s: 2.2, e: 4.6 }, { n: 3, s: 0, e: 3.5 }, { n: 2, s: 7.8, e: 10.6 }, { n: 2, s: 35.6, e: 38.0 }],
      texts: [
        { t: 0, d: 2.3, text: "سوال فوتبالی داریم", pos: "top", anim: "words" },
        { t: 2.5, d: 3.2, text: "اینو بلدی؟", pos: "top", anim: "slide-up" },
        { t: 7.2, d: 1.5, text: "زیدان", pos: "bottom", anim: "highlight" },
        { t: 9.0, d: 2.0, text: "لینک تو بیو", pos: "bottom", anim: "shake" },
      ],
      marks: [
        { type: "leak", t: 0, style: "warm" },
        { type: "sticker", name: "fire", t: 0.3, d: 2.0, x: 0.8, y: 0.33, s: 0.26 },
        { type: "sticker", name: "question", t: 2.6, d: 3.0, x: 0.86, y: 0.2, s: 0.2 },
        { type: "sticker", name: "think", t: 3.8, d: 2.0, x: 0.15, y: 0.93, s: 0.2 },
        { type: "burst", t: 7.1, n: 2, x: 0.5, y: 0.655 },
        { type: "sparkle", t: 7.2, n: 2, x: 0.5, y: 0.655 },
        { type: "sticker", name: "check", t: 7.2, d: 1.5, n: 2, x: 0.86, y: 0.655, s: 0.17 },
        { type: "confetti", t: 7.1 },
        { type: "leak", t: 8.4, style: "pink" },
        { type: "sticker", name: "point-down", t: 9.0, d: 2.0, x: 0.5, y: 0.38, s: 0.2 },
      ],
      subtitles: true, subs: ["یه بازی جدید ساختم.", "ببین دانلود کنین."], music: "energetic", look: "vivid",
      transitions: ["whip-left", "zoom", "dip"], coverFrom: { n: 3 }, cover: "اینو بلدی؟",
    },
  },
  // safe zones + brand kit: game shown framed, texts/stickers pushed to the edges must be pulled into the safe zone,
  // pink accent (highlight box, bar, arrow, karaoke), logo watermark, outro card with CTA + handle; quiz recipe → risers + music dips
  "brand-safezones-quiz": {
    files: [["video", "game.mp4"], ["image", "quiz.jpg"]],
    brand: { color: "#FF3B6B", handle: "@quiz.of.thrones", outro: true, watermark: true, logo: "logo.png" },
    plan: {
      recipe: "quiz", framed: [1],
      clips: [{ n: 2, s: 0, e: 3 }, { n: 1, s: 0.0, e: 3.0 }, { n: 1, s: 7.8, e: 10.6 }, { n: 1, s: 19.8, e: 22.6 }],
      texts: [
        { t: 0, d: 2.8, text: "فقط ۱٪ جواب میدن", pos: "top", anim: "words" },
        { t: 3.2, d: 2.6, text: "سوال اول", pos: "bottom", anim: "slide-right" },
        { t: 6.3, d: 2.0, text: "زیدان", pos: "bottom", anim: "highlight" },
        { t: 9.1, d: 2.2, text: "هفت به یک!", pos: "center", anim: "shake" },
      ],
      marks: [
        { type: "bar", t: 3.0, d: 2.8 },
        { type: "sticker", name: "fire", t: 0.2, d: 2.5, x: 0.98, y: 0.98, s: 0.3 },
        { type: "sticker", name: "check", t: 6.3, d: 2, n: 1, x: 0.86, y: 0.655, s: 0.17 },
        { type: "arrow", t: 6.1, d: 2, n: 1, x: 0.8, y: 0.62 },
        { type: "confetti", t: 6.3 },
      ],
      subtitles: false, music: "energetic", look: "pop", cta: "جوابتو کامنت کن",
      transitions: ["zoom", "flash", "slide-up"], coverFrom: { n: 2 }, cover: "اینو بلدی؟",
    },
  },
  // the AI only names the recipe: no transitions, no anims, no music, no text at 0 → recipe + hook rule fill everything in
  "recipe-defaults-hook": {
    files: [["video", "talk-short.mp4"], ["video", "game.mp4"], ["image", "quiz.jpg"]],
    transcript: talkShort(1),
    plan: {
      recipe: "promo", framed: [2],
      clips: [{ n: 1, s: 2.2, e: 4.6 }, { n: 3, s: 0, e: 6 }, { n: 2, s: 7.8, e: 10.6 }, { n: 2, s: 35.6, e: 38 }],
      texts: [{ t: 3.0, d: 2, text: "اینو بلدی؟", pos: "top" }, { t: 6.0, d: 1.6, text: "زیدان", pos: "bottom" }, { t: 8.5, d: 2, text: "لینک تو بیو", pos: "bottom" }],
      hooks: ["بازی جدیدم اومد", "اینو ببین"], subtitles: true, subs: ["یه بازی جدید ساختم.", "ببین دانلود کنین."],
      coverFrom: { n: 3 }, cover: "بازی جدید",
    },
  },
  // story recipe: calm (soft transitions, no risers, no pop on every text, music quieter under the voice)
  "story-calm": {
    files: [["video", "talk-long.mp4"]],
    transcript: talkLong(1),
    plan: {
      recipe: "story",
      clips: [{ n: 1, s: 0.3, e: 16.8 }, { n: 1, s: 30.2, e: 47.4 }],
      texts: [{ t: 0, d: 3, text: "یه آزمایش ساده", pos: "top" }],
      subtitles: true, subs: talkLong(1).map((s) => s.text), look: "warm", transitions: [], emphasis: [1],
      coverFrom: { n: 1, s: 3 }, cover: "آزمایش",
    },
  },
  // English dialogue → Persian karaoke subtitles, widescreen with two faces → smart crop, auto colour, story recipe
  "tos-translate": {
    files: [["video", "tos-scene.mp4"]],
    transcript: tosLines(1).transcript, spokenLang: "english",
    plan: {
      recipe: "story",
      clips: [{ n: 1, s: 0.3, e: 19.8 }, { n: 1, s: 20.2, e: 23.4 }],
      texts: [{ t: 0, d: 2.5, text: "عشق یا ربات؟", pos: "top", anim: "words" }],
      subtitles: true, subs: tosLines(1).subs, music: "emotional", look: "cinematic", transitions: ["dip"], emphasis: [6],
      marks: [{ type: "leak", t: 19.2, style: "warm" }],
      coverFrom: { n: 1, s: 6 }, cover: "عشق یا ربات؟",
    },
  },
  // stock footage (CC0, Wikimedia): oven timelapse → before/after recipe, wide 16:9 without faces → centred 4:5 window,
  // no speech, music only (epic = the recipe's default), riser + music drop before the reveal, warm look
  "stock-before-after": {
    files: [["video", "stock/cookies.ogv"]],
    plan: {
      recipe: "before-after",
      clips: [{ n: 1, s: 0.0, e: 3.2 }, { n: 1, s: 15.5, e: 19.8 }],
      texts: [
        { t: 0, d: 3, text: "۱۰ دقیقه توی فر", pos: "top", anim: "words" },
        { t: 3.3, d: 2.4, text: "نتیجه؟", pos: "center", anim: "highlight" },
        { t: 5.6, d: 1.8, text: "طلایی و ترد", pos: "top", anim: "bounce" },
      ],
      marks: [
        { type: "sticker", name: "fire", t: 0.4, d: 2.5, x: 0.8, y: 0.25, s: 0.22 },
        { type: "sparkle", t: 3.4, x: 0.5, y: 0.5 },
        { type: "sticker", name: "heart", t: 5.6, d: 1.8, x: 0.2, y: 0.75, s: 0.2 },
      ],
      subtitles: false, look: "warm", transitions: [], cta: "دستورش تو کامنت",
      coverFrom: { n: 1, s: 18 }, cover: "قبل و بعد فر",
    },
  },
  // the plan the real Opus 5.5 returned (via GapGPT) for talk + game + photo, replayed offline as a regression test.
  // Whisper's line times (2.5-3.3, 3.3-4.42) sit partly in silence → they must be moved onto the real speech, not cut away.
  "real-opus-plan": {
    files: [["video", "talk-short.mp4"], ["video", "game.mp4"], ["image", "quiz.jpg"]],
    brand: { color: "#FF3B6B", handle: "@quiz.of.thrones", outro: true, watermark: true, logo: "logo.png" },
    transcript: talkShort(1),
    plan: {
      recipe: "quiz", framed: [2],
      clips: [{ n: 1, s: 2.3, e: 4.6 }, { n: 2, s: 4, e: 12.5 }, { n: 2, s: 17, e: 21 }, { n: 2, s: 26, e: 32 }],
      texts: [
        { t: 0, d: 2.3, text: "کوییز فوتبالی خودم!", pos: "top", anim: "words" },
        { t: 2.4, d: 2.5, text: "سوال اول، بلدی؟", pos: "top", anim: "slide-up" },
        { t: 9.3, d: 1.5, text: "زیدان!", pos: "center", anim: "highlight" },
        { t: 11, d: 3.6, text: "اینو خودت جواب بده", pos: "top", anim: "bounce" },
        { t: 15, d: 2.2, text: "سوال سوم سخته", pos: "top", anim: "shake" },
        { t: 18.6, d: 2.2, text: "جوابش؟ تو کامنتا", pos: "top", anim: "pop" },
      ],
      marks: [
        { type: "bar", t: 3.5, d: 5.5 },
        { type: "circle", t: 9.3, d: 1.5, n: 2, x: 0.5, y: 0.6 },
        { type: "sticker", name: "question", t: 11.2, d: 2.5, x: 0.8, y: 0.25, s: 0.25 },
        { type: "arrow", t: 16, d: 2.5, n: 2, x: 0.22, y: 0.2 },
        { type: "sticker", name: "point-down", t: 18.8, d: 2, x: 0.5, y: 0.85, s: 0.22 },
      ],
      music: "energetic", look: "natural", transitions: ["zoom", "whip-left", "slide-up"], emphasis: [1], cta: "لینک دانلود تو بیو",
      subtitles: true, subs: ["یه بازی جدید ساختم.", "ببین دانلود کنین."], coverFrom: { n: 3 }, cover: "کوییز فوتبالی، بلدی؟",
    },
  },
  // energetic "weekend trip" montage from 5 CC0 stock clips: fast cuts on the beat, rapid-fire recap, every overlay type,
  // subject position (x) for the off-centre bird, natural sound quiet under the music, cyan brand + outro
  "stock-energetic": {
    files: [["video", "stock/walkway.webm"], ["video", "stock/vw-t2.webm"], ["video", "stock/husky.webm"], ["video", "stock/bird.webm"], ["video", "stock/cookies.ogv"]],
    brand: { color: "#00D1FF", handle: "@weekend.vibes", outro: true, watermark: false, logo: "../../assets/stickers/rocket.png" },
    plan: {
      recipe: "promo",
      clips: [
        { n: 1, s: 2.0, e: 3.6 },
        { n: 2, s: 3.0, e: 5.0, x: 0.55 }, { n: 2, s: 5.6, e: 7.2, x: 0.45 },
        { n: 3, s: 22.5, e: 24.5 }, { n: 3, s: 27.0, e: 28.6, x: 0.6 },
        { n: 4, s: 9.8, e: 11.6, x: 0.33 }, { n: 4, s: 19.0, e: 20.4, x: 0.33 },
        { n: 5, s: 16.0, e: 18.0 },
        { n: 1, s: 10.0, e: 10.7 }, { n: 2, s: 6.3, e: 7.0, x: 0.45 }, { n: 3, s: 31.0, e: 31.7 }, { n: 5, s: 0.5, e: 1.2 },
      ],
      texts: [
        { t: 0, d: 1.6, text: "آخر هفته رسید!", pos: "top", anim: "words" },
        { t: 1.7, d: 1.8, text: "بزن به جاده", pos: "top", anim: "slide-right" },
        { t: 5.3, d: 1.8, text: "همسفرت آماده‌ست", pos: "top", anim: "bounce" },
        { t: 7.3, d: 1.4, text: "اووووو!", pos: "center", anim: "shake" },
        { t: 8.9, d: 1.6, text: "مهمون سرزده", pos: "top", anim: "highlight" },
        { t: 12.1, d: 1.8, text: "خوراکی هم ردیفه", pos: "top", anim: "pop" },
        { t: 14.1, d: 2.6, text: "بریم؟", pos: "center", anim: "bounce" },
      ],
      marks: [
        { type: "leak", t: 0, style: "warm" },
        { type: "sticker", name: "rocket", t: 1.9, d: 1.6, x: 0.78, y: 0.3, s: 0.22 },
        { type: "sparkle", t: 3.8, x: 0.5, y: 0.52 },
        { type: "sticker", name: "laugh", t: 5.5, d: 1.6, x: 0.78, y: 0.3, s: 0.24 },
        { type: "burst", t: 7.3, x: 0.47, y: 0.47 },
        { type: "sticker", name: "eyes", t: 9.1, d: 1.5, x: 0.2, y: 0.3, s: 0.22 },
        { type: "sticker", name: "fire", t: 12.3, d: 1.6, x: 0.78, y: 0.3, s: 0.24 },
        { type: "leak", t: 13.7, style: "pink" },
        { type: "confetti", t: 14.1 },
      ],
      subtitles: false, music: "energetic", look: "pop", cta: "فالو کن، بریم سفر",
      transitions: ["whip-left", "zoom", "slice", "cut", "wind", "cut", "flash", "push-left", "cut", "cut", "cut"],
      coverFrom: { n: 2, s: 5.2 }, cover: "آخر هفته کجا بریم؟",
    },
  },
  // cinematic recipe (the "short film" style): dialogue scene + slow-motion cutaways from other cameras, hard cuts,
  // thin film subtitles, film grade + grain + vignette, shot matching across 4 different sources, no stickers (the plan
  // asks for one and for a whip transition on purpose: both must be dropped)
  "cinematic-film": {
    files: [["video", "tos-scene.mp4"], ["video", "stock/vw-t2.webm"], ["video", "stock/bird.webm"], ["video", "stock/cookies.ogv"]],
    transcript: tosLines(1).transcript, spokenLang: "english",
    plan: {
      recipe: "cinematic",
      clips: [
        { n: 2, s: 5.4, e: 6.9, speed: 0.5, x: 0.45 },
        { n: 1, s: 0.3, e: 8.2 },
        { n: 3, s: 9.9, e: 11.1, speed: 0.5, x: 0.33 },
        { n: 1, s: 8.2, e: 19.6 },
        { n: 4, s: 16.5, e: 17.7, speed: 0.4 },
      ],
      texts: [{ t: 0, d: 2.8, text: "دیدار", pos: "center" }, { t: 25.9, d: 2.8, text: "ادامه دارد", pos: "center" }],
      marks: [{ type: "sticker", name: "fire", t: 1, d: 2, x: 0.5, y: 0.5 }],
      subtitles: true, subs: tosLines(1).subs, music: "emotional", look: "film",
      transitions: ["whip-left", "cut", "cut", "dip"], emphasis: [],
      coverFrom: { n: 1, s: 12 }, cover: "دیدار",
    },
  },
  // a video with no sound track at all + a photo (silent audio is generated), bw look
  "no-audio-input": {
    files: [["video", "silent.mp4"], ["image", "quiz.jpg"]],
    plan: {
      clips: [{ n: 1, s: 0, e: 3 }, { n: 2, s: 0, e: 3 }],
      texts: [{ t: 0.2, d: 2.5, text: "بدون صدا", pos: "center" }],
      subtitles: false, music: "none", look: "bw", transitions: ["dip"], coverFrom: { n: 1, s: 1 }, cover: "سیاه و سفید",
    },
  },
  // game recording (its own sound, no speech), no music: the source must pass through untouched (no voice filters,
  // same tone balance as the source); only the level changes
  "soundtrack-passthrough": {
    files: [["video", "game.mp4"]],
    expectAudio: { 1: "music_or_mixed" }, spectrum: { n: 1, s: 2, e: 14 },
    plan: { clips: [{ n: 1, s: 2, e: 14 }], texts: [], subtitles: false, music: "none", look: "natural", transitions: [], coverFrom: { n: 1, s: 3 }, cover: "" },
  },
};

// length enforced in code (P1-2): the same plans with a chosen length; the final video must land within ±10 %
CASES["length-trim-30"] = { ...CASES["talk-jumpcuts-karaoke"], length: 30 };
CASES["length-extend-30"] = {
  files: [["video", "game.mp4"], ["image", "quiz.jpg"]], length: 30,
  plan: { clips: [{ n: 1, s: 2, e: 6 }, { n: 2, s: 0, e: 3 }, { n: 1, s: 20, e: 24 }], texts: [{ t: 0, d: 2.5, text: "جوابشو می‌دونی؟", pos: "top" }], subtitles: false, music: "energetic", look: "natural", transitions: [], coverFrom: { n: 1, s: 3 }, cover: "" },
};

// Arcane run 2 replayed offline (copyrighted, local only): the real plan + the real Whisper junk it got.
// Before P0-2 this rendered with voice filters on the film mix and the film audio at full level under the music.
const arcane = path.resolve("data/test-out/arcane-plan2.json");
if (fs.existsSync(arcane)) {
  const a = JSON.parse(fs.readFileSync(arcane, "utf8"));
  CASES["arcane-soundtrack"] = { files: [["video", "arcane.mp4"]], transcript: a.transcript, spokenLang: "persian", plan: a.plan, expectAudio: { 1: "music_or_mixed" },
    // P1-4: scene changes get soft joins (was 13 hard cuts of 15), busy footage behind the text gets a backing
    expectSoft: true, expectBackdrop: true };
  // asked 60 s, the real model planned 55 s → code makes it 60
  CASES["length-arcane-60"] = { ...CASES["arcane-soundtrack"], length: 60 };
}

const loudness = async (file) => {
  const log = await ffmpeg(["-i", file, "-af", "ebur128=framelog=quiet", "-f", "null", "-"]).catch((e) => e.message);
  return +(log.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0] ?? NaN);
};
const sheet = (video, out, cols = 8) =>
  ffmpeg(["-i", video, "-vf", `fps=1,scale=150:-2,tile=${cols}x3`, "-frames:v", "1", out]).catch(() => {});

// tone balance: level of 3 bands relative to the whole signal (dB). Equal within ~1.5 dB = the sound was not reshaped.
async function bands(file, s = 0, e = 0) {
  const span = e ? ["-ss", String(s), "-t", String(e - s)] : [];
  const rms = async (af) => {
    const log = await ffmpegScan([...span, "-i", file, "-vn", "-af", `${af}astats=measure_perchannel=none:measure_overall=RMS_level`, "-f", "null", "-"], /RMS level dB/);
    return +(log.match(/RMS level dB: (-?[\d.]+)/)?.[1] ?? NaN);
  };
  const all = await rms("");
  return [await rms("lowpass=f=250,lowpass=f=250,"), await rms("highpass=f=250,lowpass=f=4000,"), await rms("highpass=f=4000,highpass=f=4000,")].map((b) => b - all);
}

// audio rules (P0-2 / P0-3). Returns a failure note, or "" when all hold.
async function audioChecks(c, o, dir, out) {
  const fails = [];
  const graph = fs.readFileSync(path.join(dir, "render-filter.txt"), "utf8");
  const classes = Object.values(o.audio || {});
  for (const [n, want] of Object.entries(c.expectAudio || {})) if (!String(o.audio?.[n]).startsWith(want)) fails.push(`input ${n} is ${o.audio?.[n]}, want ${want}`);
  // voice processing and ducking only when some input is speech
  if (!classes.some((k) => k.startsWith("speech"))) {
    for (const f of ["afftdn", "deesser", "acompressor", "sidechaincompress"]) if (graph.includes(f)) fails.push(`${f} without speech`);
  }
  if (!classes.some((k) => k.endsWith("+denoise")) && graph.includes("afftdn")) fails.push("afftdn without a noisy input");
  // footage with its own soundtrack under our music: muted, never both at full level
  if (o.music && classes.includes("music_or_mixed") && !graph.includes("volume=0,")) fails.push("own soundtrack not muted under music");
  if (graph.includes("loudnorm")) fails.push("dynamic loudnorm still in the graph");
  const ld = await loudnessOf(out);
  if (ld.tp > -1.0) fails.push(`true peak ${ld.tp} dBTP`);
  if (c.spectrum) {
    const src = await bands(path.join(FX, c.files[c.spectrum.n - 1][1]), c.spectrum.s, c.spectrum.e), dst = await bands(out);
    const worst = Math.max(...src.map((b, i) => Math.abs(b - dst[i])));
    if (!(worst <= 1.5)) fails.push(`tone changed by ${worst.toFixed(1)} dB (src ${src.map((x) => x.toFixed(1))} out ${dst.map((x) => x.toFixed(1))})`);
  }
  return fails.join("; ");
}

const filter = process.argv[2] || "";
const results = [];

// colour looks: one cover frame per look on the face clip and on the game (fast, no full render)
if ("looks".includes(filter) || !filter) {
  const dir = path.join(OUT, "looks");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(FX, "talk-short.mp4"), path.join(dir, "a.mp4"));
  fs.copyFileSync(path.join(FX, "game.mp4"), path.join(dir, "b.mp4"));
  fs.writeFileSync(path.join(dir, "label.ass"), buildAss({}));
  const tiles = [];
  for (const look of Object.keys(LOOKS))
    for (const [src, t] of [["a.mp4", 3], ["b.mp4", 9.5]]) {
      fs.writeFileSync(path.join(dir, `${look}.ass`), buildAss({ texts: [{ start: 0, end: 10, text: look, style: "Top" }] }));
      const out = `${look}-${src[0]}.jpg`;
      await renderCover(dir, { file: src, start: t, isImage: false, look }, `${look}.ass`, out);
      tiles.push(out);
    }
  await ffmpeg([...tiles.flatMap((t) => ["-i", t]), "-filter_complex", `${tiles.map((_, i) => `[${i}]scale=144:256[s${i}]`).join(";")};${tiles.map((_, i) => `[s${i}]`).join("")}xstack=inputs=${tiles.length}:grid=10x2`.replace("grid=10x2", `layout=${tiles.map((_, i) => `${Math.floor(i / 2) * 144}_${(i % 2) * 256}`).join("|")}`), path.join(OUT, "looks-sheet.jpg")], dir);
  results.push({ case: "looks", ok: fs.existsSync(path.join(OUT, "looks-sheet.jpg")), note: `${Object.keys(LOOKS).length} looks` });
}

for (const [name, c] of Object.entries(CASES)) {
  if (filter && !name.includes(filter)) continue;
  const missing = c.files.find(([, src]) => !fs.existsSync(path.join(FX, src)));
  if (missing) {
    results.push({ case: name, ok: true, note: `skipped: ${missing[1]} not downloaded` });
    continue;
  }
  const id = `_test-${name}`;
  const dir = path.resolve("data/jobs", id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const inputs = c.files.map(([type, src], i) => {
    const file = `in${i + 1}.${type === "image" ? "jpg" : "mp4"}`;
    fs.copyFileSync(path.join(FX, src), path.join(dir, file));
    return { n: i + 1, type, file };
  });
  const t0 = Date.now();
  try {
    const brand = c.brand ? { ...c.brand, logo: c.brand.logo ? path.join(FX, c.brand.logo) : null } : undefined;
    const r = await runReel({ id, inputs, brief: "", brand, length: c.length }, "Niche: بازی کوییز فوتبالی", () => {}, { plan: c.plan, transcript: c.transcript || [], spokenLang: c.spokenLang });
    const out = path.join(OUT, `${name}.mp4`);
    fs.copyFileSync(path.join(dir, "out.mp4"), out);
    fs.copyFileSync(path.join(dir, "cover.jpg"), path.join(OUT, `${name}-cover.jpg`));
    await sheet(out, path.join(OUT, `${name}-sheet.jpg`));
    const real = (await probe(out)).duration, lufs = await loudness(out), o = r.output;
    const durOk = Math.abs(real - o.duration) <= 1.0, loudOk = (!o.music && !o.narration) || (lufs >= -16 && lufs <= -13); // no voice and no music → only a few sound effects, loudness is not meaningful. Peaky mixes (many sound effects) land up to 2 dB under -14: the limiter takes the peaks, the gain is not raised again
    const audioFail = [await audioChecks(c, o, dir, out), c.length && Math.abs(real - c.length) > c.length * 0.1 && `length ${real.toFixed(1)} s, asked ${c.length}`,
      // hand-written plans must be valid as written (the schema would hide a broken test plan by repairing it)
      !c.planIssuesOk && o.planIssues?.length && `plan: ${o.planIssues.join(" | ")}`,
      c.expectSoft && !o.transitions.some((n) => ["dip", "fade"].includes(n)) && "no soft transition",
      c.expectBackdrop && !o.backdrops && "no text backing"].filter(Boolean).join("; ");
    results.push({
      case: name, ok: durOk && loudOk && !audioFail && r.usage.tokens === 0, sec: ((Date.now() - t0) / 1000).toFixed(0),
      dur: real.toFixed(1), lufs: lufs.toFixed(1), tokens: r.usage.tokens,
      note: [o.look, o.transitions.length && `${o.transitions.length} transitions`, o.jumpCuts && `${o.jumpCuts} jump cuts`, o.emphasis && `${o.emphasis} emphasis`, o.smartCrop && "smart crop", o.music && "music", o.subtitles && "karaoke", audioFail].filter(Boolean).join(", "),
    });
  } catch (e) {
    results.push({ case: name, ok: false, sec: ((Date.now() - t0) / 1000).toFixed(0), note: e.message.slice(0, 300) });
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

console.table(results.map((r) => ({ ...r, ok: r.ok ? "PASS" : "FAIL" })));
console.log(`frames: ${OUT}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
