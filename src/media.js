// ffmpeg helpers: probe, frames for the AI, audio for speech-to-text, final 9:16 render and cover.
// ffmpeg: ffmpeg-static by default, or FFMPEG_PATH (see ffmpeg-path.js).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ffmpegPath } from "./ffmpeg-path.js";

export const W = 720, H = 1280; // output size (9:16). 720p keeps rendering fast on a normal PC.
const FONT_DIR = path.resolve("node_modules/vazirmatn/fonts/ttf");

export function ffmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ["-hide_banner", "-y", ...args], { cwd, windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-8000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error("ffmpeg: " + err.split("\n").slice(-4).join(" ")))));
  });
}

/**
 * Run an analysis filter and return the log lines that match `keep`: ALL of them, however long the file is.
 * (ffmpeg() keeps only the tail of the log, which on long videos silently lost everything but the last few seconds.)
 */
export function ffmpegScan(args, keep, cwd, {strict=false}={}) {
  return new Promise((resolve,reject) => {
    const p = spawn(ffmpegPath, ["-hide_banner", "-nostats", "-y", ...args], { cwd, windowsHide: true });
    const lines = [];
    let rest = "";
    p.stderr.on("data", (d) => {
      const parts = (rest + d).split(/\r?\n|\r/);
      rest = parts.pop();
      for (const l of parts) if (keep.test(l)) lines.push(l);
    });
    p.on("error", error => strict?reject(error):resolve(lines.join("\n")));
    p.on("close", code => {
      if (keep.test(rest)) lines.push(rest);
      if(strict&&code!==0)return reject(new Error('بررسی محلی رسانه کامل نشد.'));
      resolve(lines.join("\n"));
    });
  });
}

/** Duration, size and whether there's an audio track (parsed from `ffmpeg -i`). */
export async function probe(file) {
  // `ffmpeg -i file` with no output exits with an error but prints the stream info we need
  const out = await new Promise((resolve) => {
    const p = spawn(ffmpegPath, ["-hide_banner", "-i", file], { windowsHide: true });
    let s = "";
    p.stderr.on("data", (d) => (s += d));
    p.on("close", () => resolve(s));
    p.on("error", () => resolve(""));
  });
  const d = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const v = out.match(/Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/);
  if (!d || !v) throw new Error("فایل ویدیو قابل خواندن نیست.");
  // phone videos are often stored landscape + a "rotate 90°" flag; ffmpeg turns them upright when decoding
  const turned = /rotation of -?(90|270)\.00 degrees|rotate\s*:\s*(90|270)/.test(out);
  const [width, height] = turned ? [+v[2], +v[1]] : [+v[1], +v[2]];
  return { duration: +d[1] * 3600 + +d[2] * 60 + +d[3], width, height, hasAudio: /Stream #.*Audio:/.test(out) };
}

/** Times (s) where the picture changes to a new shot (local scene detection, for choosing which frames the AI sees). */
/**
 * Contact sheet for LONG videos: many small frames, each labelled with its time, tiled into ONE image.
 * The AI sees the whole video (e.g. 24 moments) for about the token price of 4 separate frames.
 * labels: text per cell instead of its time (e.g. "M3" when the model picks moments by number).
 */
export async function contactSheet(cwd, file, times, outFile, portrait, labels = null) {
  const cw = portrait ? 144 : 256, ch = portrait ? 256 : 144, cols = portrait ? 6 : 4;
  const font = path.relative(cwd, path.join(FONT_DIR, "Vazirmatn-Bold.ttf")).replace(/\\/g, "/");
  for (let i = 0; i < times.length; i++)
    await ffmpeg(["-ss", times[i].toFixed(2), "-i", file, "-frames:v", "1", "-vf",
      `scale=${cw}:${ch}:force_original_aspect_ratio=decrease,pad=${cw}:${ch}:(ow-iw)/2:(oh-ih)/2,drawtext=fontfile=${font}:text='${labels ? labels[i] : `${times[i].toFixed(1)}s`}':x=4:y=4:fontsize=17:fontcolor=white:box=1:boxcolor=black@0.75:boxborderw=3`,
      "-q:v", "4", `cell-${i}.jpg`], cwd);
  await ffmpeg(["-framerate", "1", "-start_number", "0", "-i", "cell-%d.jpg", "-vf", `tile=${cols}x${Math.ceil(times.length / cols)}`, "-frames:v", "1", "-q:v", "4", outFile], cwd);
  for (let i = 0; i < times.length; i++) fs.rmSync(path.join(cwd, `cell-${i}.jpg`), { force: true });
  return path.join(cwd, outFile);
}

/**
 * Black bars baked into the picture (letterboxed films / exports) at time t → { top, h } in pixels, or null.
 * Only clean, symmetric top/bottom bars are accepted; a dark scene is never mistaken for bars (the crop must keep ≥55%).
 */
export async function detectBars(file, t, width, height) {
  const log = await ffmpeg(["-ss", Math.max(0, t).toFixed(2), "-t", "1.5", "-i", file, "-an", "-vf", "cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"]).catch(() => "");
  const m = [...log.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop();
  if (!m) return null;
  const [w, h, x, y] = m.slice(1).map(Number);
  const bottom = height - h - y;
  if (w < width * 0.97 || x > width * 0.02 || h > height * 0.95 || h < height * 0.55 || Math.abs(y - bottom) > 10) return null;
  return { top: y, h };
}

export async function sceneChanges(file, threshold = 0.3) {
  const log = await ffmpegScan(["-i", file, "-an", "-vf", `scale=160:-2,select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"], /pts_time:/);
  return [...log.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]).filter((t, i, a) => i === 0 || t - a[i - 1] > 0.5);
}

/** Small JPEG frames (longest side 384px) for the AI. */
export async function frameAt(file, t, outFile, size = 384) {
  // no -ss for t=0: seeking a still image (jpg) gives an empty output
  await ffmpeg([...(t > 0 ? ["-ss", t.toFixed(2)] : []), "-i", file, "-frames:v", "1", "-vf", `scale='if(gt(iw,ih),${size},-2)':'if(gt(iw,ih),-2,${size})'`, "-q:v", "5", outFile]);
  return outFile;
}

/** Mono 16 kHz low-bitrate audio → small file for speech-to-text. */
export async function extractAudio(file, outFile, maxSec = 300) {
  await ffmpeg(["-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-t", String(maxSec), outFile]);
  return outFile;
}

/** Quiet parts of a video's sound → [[start, end], …] in seconds (for jump cuts). */
export async function detectSilences(file, noiseDb = -32, minSec = 0.45) {
  const log = await ffmpegScan(["-i", file, "-vn", "-af", `silencedetect=noise=${noiseDb}dB:d=${minSec}`, "-f", "null", "-"], /silence_(start|end)/);
  const out = [];
  let start = null;
  for (const line of log.split("\n")) {
    const s = line.match(/silence_start: (-?[\d.]+)/), e = line.match(/silence_end: ([\d.]+)/);
    if (s) start = Math.max(0, +s[1]);
    if (e && start != null) out.push([start, +e[1]]), (start = null);
  }
  if (start != null) out.push([start, Infinity]);
  return out;
}

/** Raw mono PCM (16-bit) of a file, straight from ffmpeg's stdout. */
function pcm(file, rate, maxSec) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ["-hide_banner", "-t", String(maxSec), "-i", file, "-vn", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"], { windowsHide: true });
    const chunks = [];
    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", () => {});
    p.on("error", reject);
    p.on("close", (code) => {
      const buf = Buffer.concat(chunks);
      if (code !== 0 && !buf.length) return reject(new Error("ffmpeg: could not decode audio"));
      resolve(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)));
    });
  });
}

/**
 * Simple beat tracker for a music track: onset strength (rise in loudness every 10 ms) →
 * tempo by autocorrelation (70-180 BPM) → beat grid that best fits the onsets.
 * Returns { bpm, beats: [seconds…] }. Good enough for cutting on the beat.
 */
export async function beatGrid(file, maxSec = 120) {
  const rate = 8000, hop = 80; // 10 ms frames
  const s = await pcm(file, rate, maxSec);
  const n = Math.floor(s.length / hop);
  if (n < 300) return { bpm: 0, beats: [] };
  const energy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = i * hop, end = Math.min(s.length, j + hop * 2); j < end; j++) e += s[j] * s[j];
    energy[i] = Math.log1p(e / (hop * 2));
  }
  const onset = new Float64Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);
  const mean = onset.reduce((a, b) => a + b, 0) / n || 1;
  for (let i = 0; i < n; i++) onset[i] /= mean;

  // tempo: autocorrelation, gently preferring 90-150 BPM (the usual Reels range)
  let best = { lag: 50, score: -1 };
  for (let lag = 33; lag <= 86; lag++) {
    let sc = 0;
    for (let i = lag; i < n; i++) sc += onset[i] * onset[i - lag];
    const bpm = 6000 / lag;
    sc *= bpm >= 90 && bpm <= 150 ? 1.1 : 1;
    if (sc > best.score) best = { lag, score: sc };
  }
  // refine period (fractional) + phase with a comb over the onsets
  const comb = (period, phase) => {
    let sc = 0;
    for (let t = phase; t < n - 1; t += period) {
      const k = Math.round(t);
      sc += Math.max(onset[k - 1] || 0, onset[k], onset[k + 1] || 0);
    }
    return sc;
  };
  let fit = { period: best.lag, phase: 0, score: -1 };
  for (let period = best.lag - 1; period <= best.lag + 1; period += 0.05)
    for (let phase = 0; phase < period; phase += 1) {
      const sc = comb(period, phase);
      if (sc > fit.score) fit = { period, phase, score: sc };
    }
  const beats = [];
  for (let t = fit.phase; t < n; t += fit.period) beats.push((t * hop) / rate);
  return { bpm: Math.round((60 * rate) / (fit.period * hop)), beats };
}

// ---------- sound effects: real recorded sounds from assets/sfx/<kind>/ (whoosh, pop, impact) ----------
// Empty folder = that kind of sound is simply not used (better silence than a cheap sound).
export const SFX_DIR = path.resolve("assets/sfx");
export const SFX_KINDS = ["whoosh", "pop", "impact", "riser"];
export function sfxLibrary(seed = 0) {
  const lib = {};
  for (const kind of SFX_KINDS) {
    let files = [];
    try {
      files = fs.readdirSync(path.join(SFX_DIR, kind)).filter((f) => /\.(wav|mp3|ogg|m4a|flac)$/i.test(f)).map((f) => path.join(SFX_DIR, kind, f));
    } catch {}
    let i = seed;
    // rotate through the files so the same sound doesn't repeat back to back
    lib[kind] = files.length ? () => files[i++ % files.length] : null;
  }
  return lib;
}

// ---------- level-2 overlays: colour emoji stickers + light leaks ----------
// stickers: assets/stickers/<name>.png (Noto Emoji, Apache 2.0; `npm run stickers` downloads them)
export const STICKER_DIR = path.resolve("assets/stickers");
export function listStickers() {
  try {
    return fs.readdirSync(STICKER_DIR).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4));
  } catch {
    return [];
  }
}
// light leaks: soft coloured light drifting across the frame (2 s), drawn by ffmpeg itself on first use, then cached
export const LEAK_DIR = path.resolve("assets/overlays");
const blob = (cx, cy, s) => `exp(-(pow(X-(${cx}),2)+pow(Y-(${cy}),2))/(2*pow(${s},2)))`;
const B1 = blob("W*(-0.1+0.35*T)", "H*0.25", "W*0.55"), B2 = blob("W*(1.1-0.25*T)", "H*0.8", "W*0.5");
const LEAKS = {
  warm: [`255*min(1,1.1*${B1}+0.9*${B2})`, `255*(0.55*${B1}+0.25*${B2})`, `255*(0.12*${B1}+0.35*${B2})`],
  pink: [`255*min(1,${B1}+0.7*${B2})`, `255*(0.25*${B1}+0.15*${B2})`, `255*min(1,0.55*${B1}+0.9*${B2})`],
  gold: [`255*min(1,${B1}+${B2})`, `255*min(1,0.8*${B1}+0.7*${B2})`, `255*(0.3*${B1}+0.2*${B2})`],
};
export const LEAK_STYLES = Object.keys(LEAKS);
export async function leakFile(style) {
  const [r, g, b] = LEAKS[style] || LEAKS.warm;
  const f = path.join(LEAK_DIR, `leak-${LEAKS[style] ? style : "warm"}.mp4`);
  if (fs.existsSync(f)) return f;
  fs.mkdirSync(LEAK_DIR, { recursive: true });
  // drawn small (fast) and scaled up + blurred: light leaks are soft anyway
  await ffmpeg(["-f", "lavfi", "-i", "color=c=black:s=180x320:r=30:d=2", "-vf",
    `format=gbrp,geq=r='${r}':g='${g}':b='${b}',scale=${W}:${H},gblur=sigma=25,fade=t=in:st=0:d=0.35,fade=t=out:st=1.1:d=0.9,format=yuv420p`,
    "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", f]);
  return f;
}

// risers ("reverse hit"): a real impact recording played backwards with a short echo → the classic build-up before a reveal.
// Made once from the files in assets/sfx/impact/ (so they're real recordings too), stored in assets/sfx/riser/.
export async function ensureRisers() {
  const dir = path.join(SFX_DIR, "riser");
  fs.mkdirSync(dir, { recursive: true });
  if (fs.readdirSync(dir).some((f) => /\.(wav|mp3|ogg)$/i.test(f))) return;
  let impacts = [];
  try {
    impacts = fs.readdirSync(path.join(SFX_DIR, "impact")).filter((f) => /\.(wav|mp3|ogg)$/i.test(f)).slice(0, 4);
  } catch {}
  for (const [k, f] of impacts.entries())
    await ffmpeg(["-i", path.join(SFX_DIR, "impact", f), "-af", "apad=pad_dur=0.6,areverse,aecho=0.8:0.6:60|120:0.35|0.25,afade=t=in:d=0.35,atrim=0:1.1", "-ar", "44100", path.join(dir, `riser-${k + 1}.wav`)]);
}

/** Average brightness (YAVG 0-255) and colourfulness (SATAVG) of a clip, from 1 frame per second (max 30). */
export async function colorStats(file, isImage, start = 0, dur = 30) {
  const log = await ffmpegScan([...(isImage ? [] : ["-ss", start.toFixed(2), "-t", Math.min(60, Math.max(1, dur)).toFixed(2)]), "-i", file, "-an", "-vf", `${isImage ? "" : "fps=2,"}scale=160:-2,signalstats,metadata=print`, "-f", "null", "-"], /signalstats\.(YAVG|SATAVG|UAVG|VAVG)=/);
  const avg = (k) => {
    const v = [...log.matchAll(new RegExp(`signalstats\\.${k}=([\\d.]+)`, "g"))].map((m) => +m[1]);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return { y: avg("YAVG"), sat: avg("SATAVG"), u: avg("UAVG"), v: avg("VAVG") };
}
/**
 * SHOT MATCHING: pull one clip's exposure, white balance and saturation toward the reel's average (`target`),
 * so clips from different cameras / light feel like one film. Deliberately gentle (65% of the difference, capped):
 * a night shot should stay darker than a beach shot, just not look like a different movie.
 */
export function matchFilter(st, target, strength = 0.65) {
  if (st.y == null || target.y == null) return "";
  const parts = [];
  // exposure: gamma that would move this clip's average brightness onto the target (ffmpeg eq: >1 brightens)
  const a = Math.min(0.97, Math.max(0.03, st.y / 255)), b = Math.min(0.97, Math.max(0.03, target.y / 255));
  const gamma = Math.min(1.4, Math.max(0.72, 1 + (Math.log(a) / Math.log(b) - 1) * strength));
  const sat = st.sat > 3 && target.sat > 3 ? Math.min(1.3, Math.max(0.78, 1 + (target.sat / st.sat - 1) * strength)) : 1;
  const eq = [Math.abs(gamma - 1) > 0.04 && `gamma=${gamma.toFixed(2)}`, Math.abs(sat - 1) > 0.05 && `saturation=${sat.toFixed(2)}`].filter(Boolean);
  // white balance: shift the colour axes (U = blue-yellow, V = red-green) toward the target's cast
  const wb = strength * 0.75, du = Math.round(Math.min(6, Math.max(-6, (target.u - st.u) * wb))), dv = Math.round(Math.min(6, Math.max(-6, (target.v - st.v) * wb)));
  if (Math.abs(du) >= 2 || Math.abs(dv) >= 2) parts.push(`lutyuv=u='clip(val+(${du}),0,255)':v='clip(val+(${dv}),0,255)'`);
  if (eq.length) parts.push(`eq=${eq.join(":")}`);
  return parts.join(",");
}
/** Exposure / saturation fix so dark, washed-out or over-bright clips match the others ("" when the clip is fine). */
// Only for real camera footage: screen recordings, UI and designed graphics (dark themes, near-black backgrounds) are left alone.
export function autoCorrect({ y, sat }, { framed = false } = {}) {
  if (y == null || framed || y < 32) return "";
  const parts = [];
  if (y < 80) parts.push(`brightness=${Math.min(0.1, ((100 - y) / 255) * 0.8).toFixed(3)}:gamma=${(1 + Math.min(0.2, (100 - y) / 180)).toFixed(2)}`);
  else if (y > 175) parts.push(`brightness=${(-Math.min(0.07, ((y - 160) / 255) * 0.6)).toFixed(3)}`);
  if (sat != null && sat > 3 && sat < 8) parts.push(`saturation=${Math.min(1.2, 10 / sat).toFixed(2)}`);
  else if (sat != null && sat > 90) parts.push("saturation=0.9");
  return parts.length ? `eq=${parts.join(":")}` : "";
}

// ---------- colour looks (ffmpeg filters, chosen by the AI per reel) ----------
export const LOOKS = {
  natural: "",
  bright: "eq=brightness=0.02:contrast=1.05:saturation=1.15",
  vivid: "eq=contrast=1.1:saturation=1.45,unsharp=5:5:0.5",
  warm: "colortemperature=temperature=5000:mix=0.6,eq=saturation=1.12:contrast=1.04",
  cool: "colortemperature=temperature=8500:mix=0.6,eq=contrast=1.05",
  cinematic: "colorbalance=rs=-0.06:bs=0.08:rh=0.08:bh=-0.07,eq=contrast=1.12:saturation=0.92,vignette=PI/5",
  vintage: "curves=preset=vintage,noise=alls=7:allf=t,vignette=PI/4",
  bw: "hue=s=0,eq=contrast=1.25:brightness=0.02",
  moody: "eq=brightness=-0.03:contrast=1.15:saturation=0.78,vignette=PI/4.5",
  pop: "vibrance=intensity=0.35,eq=contrast=1.08,unsharp=5:5:0.6",
  // film: teal shadows / warm highlights, lifted blacks, a little less colour (the "short film" grade)
  film: "colorbalance=rs=-0.09:gs=-0.02:bs=0.1:rh=0.09:gh=0.02:bh=-0.1,curves=m='0/0.035 0.5/0.47 1/0.96',eq=saturation=0.82:contrast=1.08",
};
// for footage that is too dark / flat (the AI flags it from the frames it sees)
const BRIGHTEN = "eq=brightness=0.07:gamma=1.18:contrast=1.05";

// ---------- transitions between shots (ffmpeg xfade), chosen by the AI per cut ----------
export const TRANSITIONS = {
  cut: null,
  fade: ["fade", 0.35],
  flash: ["fadewhite", 0.3],
  dip: ["fadeblack", 0.4],
  "whip-left": ["smoothleft", 0.25],
  "whip-right": ["smoothright", 0.25],
  "whip-up": ["smoothup", 0.25],
  "slide-left": ["slideleft", 0.35],
  "slide-up": ["slideup", 0.35],
  "push-left": ["coverleft", 0.3],
  zoom: ["zoomin", 0.35],
  circle: ["circleopen", 0.4],
  pixel: ["pixelize", 0.35],
  blur: ["hblur", 0.3],
  squeeze: ["squeezeh", 0.3],
  wind: ["hlwind", 0.4],
  slice: ["hlslice", 0.35],
  radial: ["radial", 0.4],
};
export const transitionLength = (name) => TRANSITIONS[name]?.[1] || 0;

// ---------- ASS subtitle file (texts on video + spoken subtitles) ----------
const ts = (s) => {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${sec}`;
};
// emoji can't be drawn in colour by libass (they come out as broken outlines) → strip them from on-video text
const assText = (t) =>
  String(t).replace(/[{}\\]/g, "").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, "").replace(/\s{2,}/g, " ").replace(/\r?\n/g, "\\N").trim();

// Reels-style text: heavy Vazirmatn (weight 900), white or yellow, thick black outline + soft shadow, no boxes.
// Encoding -1 = libass picks the text direction per line → punctuation lands on the correct side in Persian.
// ---------- motion text (level 1 motion graphics): animation templates, all done by libass inside ffmpeg ----------
export const TEXT_ANIMS = ["pop", "slide-up", "slide-right", "words", "bounce", "shake", "highlight", "wipe", "fade"];
const ANCHOR = { Top: [8, 150], Center: [2, H - 560], Bottom: [2, H - 420] }; // [alignment, y] of each text style
function animTags(style, anim) {
  const [an, y] = ANCHOR[style] || ANCHOR.Top, x = (SAFE.left + SAFE.right) / 2;
  const fade = "\\fad(120,150)";
  switch (anim) {
    case "fade": // slow, quiet fade (cinematic)
      return "{\\fad(450,450)}";
    case "slide-up": // rises into place
      return `{\\an${an}\\move(${x},${y + 80},${x},${y},0,260)${fade}}`;
    case "slide-right": // flies in from the right edge (the direction Persian is read from)
      return `{\\an${an}\\move(${x + 460},${y},${x},${y},0,240)${fade}}`;
    case "bounce":
      return `{${fade}\\fscx30\\fscy30\\t(0,170,\\fscx122\\fscy122)\\t(170,270,\\fscx90\\fscy90)\\t(270,350,\\fscx104\\fscy104)\\t(350,420,\\fscx100\\fscy100)}`;
    case "shake": // punchline: pops in, then a short angry wiggle
      return `{${fade}\\fscx80\\fscy80\\t(0,100,\\fscx100\\fscy100)\\t(100,150,\\frz-5)\\t(150,210,\\frz5)\\t(210,270,\\frz-4)\\t(270,330,\\frz3)\\t(330,390,\\frz0)}`;
    case "wipe":
    case "highlight": // revealed right → left, like Persian is read
      return `{\\fad(0,150)\\clip(${W},0,${W},${H})\\t(0,380,\\clip(0,0,${W},${H}))}`;
    default: // pop: 70% → 104% → 100% + fade
      return "{\\fad(120,120)\\fscx70\\fscy70\\t(0,140,\\fscx104\\fscy104)\\t(140,220,\\fscx100\\fscy100)}";
  }
}

// shapes drawn with ASS vector drawing (\p1); positions are in output pixels
// accent colour (brand kit; default yellow) — set by buildAss for each file, used by marks / highlight / karaoke
let YELLOW = "&H0000D4FF&";
/** "#RRGGBB" → ASS colour "&H00BBGGRR" (+ whether it's a light colour, so text on it should be dark) */
export function assColour(hex = "#FFD400") {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) || [null, "FF", "D4", "00"];
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  return { ass: `&H00${m[3]}${m[2]}${m[1]}`.toUpperCase().replace("&H", "&H"), light: 0.299 * r + 0.587 * g + 0.114 * b > 150 };
}
// tiny seeded random, so the same plan always renders the same confetti
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
function particles(m) {
  const out = [], rand = rng(Math.round(m.start * 1000) + 7);
  const px = Math.round(m.x), py = Math.round(m.y);
  if (m.type === "confetti") {
    // ~45 paper pieces falling from the top, spinning, in party colours
    const colours = ["&H0000D4FF&", "&H00B469FF&", "&H00FFD000&", "&H0050E070&", "&H00FFFFFF&", "&H00309CFF&"];
    for (let i = 0; i < 45; i++) {
      const s = m.start + rand() * 0.5, dur = 1.4 + rand() * 1.1, x0 = Math.round(rand() * W), y0 = -30 - Math.round(rand() * 220);
      const x1 = x0 + Math.round((rand() - 0.5) * 300), spin = Math.round((rand() > 0.5 ? 1 : -1) * (360 + rand() * 540));
      const w = 10 + Math.round(rand() * 8), h = 18 + Math.round(rand() * 12);
      out.push(`Dialogue: 3,${ts(s)},${ts(Math.min(m.end + 1, s + dur))},Mark,,0,0,0,,{\\an7\\move(${x0},${y0},${x1},${H + 40})\\p1\\1c${colours[i % colours.length]}\\bord0\\shad0\\frz${Math.round(rand() * 360)}\\t(\\frz${spin})\\fad(0,300)}m 0 0 l ${w} 0 l ${w} ${h} l 0 ${h}{\\p0}`);
    }
  } else if (m.type === "sparkle") {
    // 7 four-point stars twinkling around the spot
    for (let i = 0; i < 7; i++) {
      const s = m.start + i * 0.12, ang = (i / 7) * Math.PI * 2 + rand(), dist = 50 + rand() * 90;
      const x = Math.round(px + Math.cos(ang) * dist), y = Math.round(py + Math.sin(ang) * dist), k = 14 + Math.round(rand() * 16);
      out.push(`Dialogue: 3,${ts(s)},${ts(s + 0.6)},Mark,,0,0,0,,{\\an7\\pos(${x},${y})\\p1\\1c${i % 2 ? YELLOW : "&H00FFFFFF&"}\\bord0\\shad0\\blur1\\fscx0\\fscy0\\t(0,250,\\fscx120\\fscy120)\\t(250,600,\\fscx0\\fscy0\\frz90)}m 0 ${-k * 2} l ${k / 3} ${-k / 3} l ${k * 2} 0 l ${k / 3} ${k / 3} l 0 ${k * 2} l ${-k / 3} ${k / 3} l ${-k * 2} 0 l ${-k / 3} ${-k / 3}{\\p0}`);
    }
  } else if (m.type === "burst") {
    // comic "speed lines" bursting out from the spot (for a big reveal)
    let path = "";
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2, r0 = 100, r1 = 220 + (i % 3) * 40, w = 5 + (i % 2) * 4;
      const c = Math.cos(a), s = Math.sin(a), nx = -s * w, ny = c * w;
      const p = (x, y) => `${Math.round(x)} ${Math.round(y)}`;
      path += `m ${p(c * r0 + nx, s * r0 + ny)} l ${p(c * r1, s * r1)} l ${p(c * r0 - nx, s * r0 - ny)} `;
    }
    out.push(`Dialogue: 0,${ts(m.start)},${ts(Math.min(m.end, m.start + 0.8))},Mark,,0,0,0,,{\\an7\\pos(${px},${py})\\p1\\1c&H00FFFFFF&\\bord3\\3c&H000000&\\shad0\\fscx50\\fscy50\\t(0,180,\\fscx105\\fscy105)\\t(180,800,\\fscx125\\fscy125\\alpha&HFF&)}${path.trim()}{\\p0}`);
  }
  return out;
}

function markEvent(m) {
  if (["confetti", "sparkle", "burst"].includes(m.type)) return particles(m).join("\n");
  const a = ts(m.start), b = ts(m.end), ms = Math.round((m.end - m.start) * 1000);
  const px = Math.round(m.x), py = Math.round(m.y);
  if (m.type === "bar") {
    // countdown: a full-width bar that shrinks to nothing over its duration (anchored right, empties toward the right)
    return `Dialogue: 2,${a},${b},Mark,,0,0,0,,{\\an9\\pos(${SAFE.right},${py})\\p1\\1c${YELLOW}\\bord3\\3c&H000000&\\shad0\\fad(150,100)\\t(0,${ms},\\fscx0)}m 0 0 l ${SAFE.right - SAFE.left} 0 l ${SAFE.right - SAFE.left} 18 l 0 18{\\p0}`;
  }
  if (m.type === "circle") {
    const r = Math.round(m.r || 90), k = Math.round(r * 0.552);
    const path = `m 0 ${-r} b ${k} ${-r} ${r} ${-k} ${r} 0 b ${r} ${k} ${k} ${r} 0 ${r} b ${-k} ${r} ${-r} ${k} ${-r} 0 b ${-r} ${-k} ${-k} ${-r} 0 ${-r}`;
    return `Dialogue: 2,${a},${b},Mark,,0,0,0,,{\\an7\\pos(${px},${py})\\p1\\1a&HFF&\\bord8\\3c${YELLOW}\\shad0\\be1\\fad(80,150)\\fscx30\\fscy30\\t(0,200,\\fscx112\\fscy112)\\t(200,300,\\fscx100\\fscy100)}${path}{\\p0}`;
  }
  // arrow pointing down, tip at (x, y): drops in, then a little squash
  return `Dialogue: 2,${a},${b},Mark,,0,0,0,,{\\an2\\move(${px},${py - 90},${px},${py},0,220)\\p1\\1c${YELLOW}\\bord5\\3c&H000000&\\shad0\\fad(80,150)\\t(220,380,\\fscy85)\\t(380,520,\\fscy100)}m 26 0 l 54 0 l 54 70 l 80 70 l 40 120 l 0 70 l 26 70{\\p0}`;
}

// SAFE ZONES (Reels / TikTok / Shorts): the platform's own UI covers the top ~110 px, the bottom ~280 px (caption, music)
// and a ~110 px column on the right (like / comment / share). Every text and sticker stays inside this box.
export const SAFE = { left: 60, right: W - 120, top: 120, bottom: H - 290 };
// cinematic text sizes, and where each style sits: [top, bottom] of its text block in 0-1 of the frame height
// (one line; Top grows downwards, the others upwards) — used to measure the footage behind it and to draw the band
const MIN_SIZE = { Top: 58, Center: 64, Bottom: 56, Sub: 48 };
export const TEXT_BAND = { Top: [0.13, 0.2], Center: [0.47, 0.53], Bottom: [0.6, 0.66], Sub: [0.67, 0.73] };
// over this edge density (or this brightness) a thin white text needs a backing to stay readable. Measured: calm
// shots 3-7 (talk, a quiet Arcane shot), busy ones 12-30 (the Arcane fight, stock clips, Tears of Steel)
export const BACKDROP = { edges: 9, luma: 150 };

/** A soft, blurred dark band across the frame behind one text (the text's own lines are estimated from its length). */
function backdropEvent(t) {
  const size = MIN_SIZE[t.style] || 56;
  const [top, bottom] = TEXT_BAND[t.style] || TEXT_BAND.Top;
  const perLine = Math.max(8, Math.floor((SAFE.right - SAFE.left) / (size * 0.5)));
  const n = Math.max(1, Math.ceil(String(t.text || "").length / perLine)), lh = size * 1.35;
  const y0 = t.style === "Top" ? top * H : bottom * H - n * lh, y1 = y0 + n * lh;
  const a = Math.round(y0 - 40), b = Math.round(y1 + 40);
  // ~70 % black, edges blurred away: reads as shade over the picture, not as a box
  return `Dialogue: 0,${ts(t.start)},${ts(t.end)},Mark,,0,0,0,,{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H000000&\\1a&H50&\\blur28\\fad(200,200)\\p1}m 0 ${a} l ${W} ${a} ${W} ${b} 0 ${b}{\\p0}`;
}

/** How busy / bright the footage is in a horizontal band (y0-y1, 0-1 of the height) at time t: {edges, luma}. */
export async function bandStats(file, t, y0, y1, isImage = false) {
  const band = `crop=iw:ih*${(y1 - y0).toFixed(3)}:0:ih*${y0.toFixed(3)},scale=360:-2,format=gray`;
  const avg = async (extra) => {
    const log = await ffmpegScan([...(isImage ? [] : ["-ss", Math.max(0, t).toFixed(2)]), "-i", file, "-frames:v", "1", "-vf", `${band}${extra},signalstats,metadata=print:key=lavfi.signalstats.YAVG`, "-f", "null", "-"], /YAVG/);
    return +(log.match(/YAVG=([\d.]+)/)?.[1] ?? NaN);
  };
  return { luma: await avg(""), edges: await avg(",edgedetect=low=0.1:high=0.3") };
}

export function buildAss({ texts = [], subs = [], marks = [], accent, minimal = false }) {
  const acc = assColour(accent);
  YELLOW = `${acc.ass}&`;
  // margins keep text out of the right-hand button column (MarginL 60, MarginR 120)
  const style = (name, size, weight, colour, outline, align, marginV) =>
    `Style: ${name},Vazirmatn,${size},${colour},&H00FFFFFF,&H00000000,&H90000000,${weight},0,0,0,100,100,0,0,1,${outline},4,${align},${SAFE.left},${W - SAFE.right},${marginV},-1`;
  // highlight = dark text on an accent box (BorderStyle 3: the outline becomes an opaque box, Outline = padding)
  const box = (name, size, align, marginV) =>
    `Style: ${name},Vazirmatn,${size},${acc.light ? "&H00141414" : "&H00FFFFFF"},&H00FFFFFF,${acc.ass},&H00000000,900,0,0,0,100,100,0,0,3,16,0,${align},${SAFE.left},${W - SAFE.right},${marginV},-1`;
  // minimal (cinematic): clean white text with a thin outline, like film subtitles. Sized to read on a phone
  // (the first version, 40-52 px at weight 300, was unreadable over the Arcane fight); busy footage behind a text
  // also gets a soft dark band (see BACKDROP).
  const thin = (name, size, weight, align, marginV) =>
    `Style: ${name},Vazirmatn,${size},&H00FFFFFF,&H00FFFFFF,&H50000000,&HA0000000,${weight},0,0,0,100,100,0,0,1,1.8,2,${align},${SAFE.left},${W - SAFE.right},${marginV},-1`;
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    minimal ? thin("Top", MIN_SIZE.Top, 500, 8, 170) : style("Top", 84, 900, "&H00FFFFFF", 6, 8, 150), // hook / headline, just under the platform's top bar
    minimal ? thin("Center", MIN_SIZE.Center, 500, 2, 600) : style("Center", 104, 900, acc.ass, 7, 2, 540), // punchline in the accent colour, middle of the screen
    minimal ? thin("Bottom", MIN_SIZE.Bottom, 500, 2, 430) : style("Bottom", 78, 900, "&H00FFFFFF", 6, 2, 420), // lower headline (above the subtitles, above the platform caption)
    minimal ? thin("Sub", MIN_SIZE.Sub, 500, 2, 340) : style("Sub", 66, 900, "&H00FFFFFF", 6, 2, 330), // spoken subtitles (karaoke: current word in the accent colour)
    style("Cover", 104, 900, "&H00FFFFFF", 8, 5, 0),
    box("TopHL", 78, 8, 160), box("CenterHL", 90, 2, 550), box("BottomHL", 72, 2, 430),
    style("Mark", 20, 400, "&H00FFFFFF", 3, 7, 0),
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  // soft dark bands behind texts / subtitles over busy footage (minimal styles only; the bold styles have a thick outline)
  if (minimal) for (const t of [...texts, ...subs.map((s) => ({ ...s, style: "Sub" }))]) if (t.backdrop) lines.push(backdropEvent(t));
  // never animate the cover (it's a single frame at t=0)
  for (const t of texts) {
    const text = assText(t.text);
    if (!text) continue;
    if (t.style === "Cover") {
      lines.push(`Dialogue: 1,${ts(t.start)},${ts(t.end)},Cover,,0,0,0,,${text}`);
      continue;
    }
    if (t.anim === "words") {
      // word by word: later words stay invisible (not missing), so the line never jumps around
      const words = text.split(" "), step = Math.min(0.35, (t.end - t.start) / (words.length + 1));
      words.forEach((_, k) => {
        const a = t.start + k * step, b = k === words.length - 1 ? t.end : a + step;
        const shown = words.map((w, i) => (i <= k ? w : `{\\alpha&HFF&}${w}{\\alpha&H00&}`)).join(" ");
        const enter = `{\\fad(${k === 0 ? 100 : 0},${k === words.length - 1 ? 150 : 0})}`;
        lines.push(`Dialogue: 1,${ts(a)},${ts(b)},${t.style},,0,0,0,,${enter}${shown}`);
      });
      continue;
    }
    const st = t.anim === "highlight" ? `${t.style}HL` : t.style;
    lines.push(`Dialogue: 1,${ts(t.start)},${ts(t.end)},${st},,0,0,0,,${animTags(t.style, t.anim)}${text}`);
  }
  for (const m of marks) lines.push(markEvent(m));
  // karaoke subtitles: the whole short line stays on screen, the word being spoken turns yellow
  const HL = `{\\c${YELLOW}}`, RESET = "{\\c&H00FFFFFF&}";
  for (const s of subs) {
    const words = (s.words || []).map((w) => ({ ...w, text: assText(w.text) })).filter((w) => w.text);
    if (minimal) {
      // film subtitles: the whole line, no karaoke colour, a soft fade
      const text = words.length ? words.map((w) => w.text).join(" ") : assText(s.text);
      if (text) lines.push(`Dialogue: 0,${ts(s.start)},${ts(s.end)},Sub,,0,0,0,,{\\fad(150,150)}${text}`);
      continue;
    }
    if (!words.length) {
      const text = assText(s.text);
      if (text) lines.push(`Dialogue: 0,${ts(s.start)},${ts(s.end)},Sub,,0,0,0,,${text}`);
      continue;
    }
    words.forEach((w, i) => {
      const a = i === 0 ? s.start : w.start, b = i === words.length - 1 ? s.end : words[i + 1].start;
      if (b - a < 0.02) return;
      const text = words.map((x, k) => (k === i ? `${HL}${x.text}${RESET}` : x.text)).join(" ");
      lines.push(`Dialogue: 0,${ts(a)},${ts(b)},Sub,,0,0,0,,${text}`);
    });
  }
  return lines.join("\n") + "\n";
}

// ---------- the 9:16 frame of one clip ----------
// fit (default): blurred, zoomed copy of the clip as background + the whole clip fitted on top (nothing important cropped).
// photo: sits a bit smaller and lower (top band stays free for the headline) + slow push-in (rendered at 2x to avoid zoompan jitter).
// crop: a landscape clip with a face becomes a real full-screen 9:16 crop that pans with the face (keys: [{t, v: face x 0-1}]).
// punch: {z, cx, cy} zoom-in aimed at the face (every other jump-cut piece ~110%, key sentences ~120%).
// look / brighten: colour filters, applied first so the blurred background matches.
// framed: a screen recording / UI video shown in the same box as photos (with a thin border), so the top band is free for
// text and nothing important sits under the platform's caption at the bottom.
// card: a plain colour clip (outro card), drawn by ffmpeg.
// auto: per-input colour correction (exposure / saturation matched across clips), applied before the look.
export const PHOTO_BOX = { w: W - 80, h: 880, top: 250 };
const even = (x) => Math.round(x / 2) * 2;
const clampN = (x, a, b) => Math.max(a, Math.min(b, x));

// piecewise-linear ffmpeg expression of t through keys [{t, v}]
function keyExpr(keys) {
  let e = keys[keys.length - 1].v.toFixed(4);
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i], b = keys[i + 1];
    const lerp = `${a.v.toFixed(4)}+(${(b.v - a.v).toFixed(4)})*(t-${a.t.toFixed(3)})/${Math.max(0.001, b.t - a.t).toFixed(3)}`;
    e = `if(lt(t,${b.t.toFixed(3)}),${lerp},${e})`;
  }
  return e;
}

function layout(i, c) {
  if (c.card) return `[${i}:v]format=yuv420p,setsar=1,fps=30,settb=AVTB[v${i}]`;
  const pre = [c.auto || "", LOOKS[c.look] || "", c.brighten ? BRIGHTEN : ""].filter(Boolean).join(",");
  // speed: slow motion (<1) / speed-up (>1); slow clips get blended in-between frames instead of stutter
  const sp = !c.isImage && c.speed && c.speed !== 1 ? `setpts=PTS/${c.speed},` : "";
  // baked-in black bars are cut off first, so the real picture fills the frame
  const bars = !c.isImage && c.bars ? `crop=iw:${c.bars.h}:0:${c.bars.top},` : "";
  const src = `[${i}:v]${sp}${bars}${pre ? pre + "," : ""}`;
  let g;
  if (c.framed && !c.isImage) {
    g = `${src}split[b${i}][f${i}];[b${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2,eq=brightness=-0.18[bb${i}];` +
      `[f${i}]scale=${PHOTO_BOX.w - 8}:${PHOTO_BOX.h - 8}:force_original_aspect_ratio=decrease,pad=iw+8:ih+8:4:4:color=white@0.85[ff${i}];` +
      `[bb${i}][ff${i}]overlay=(W-w)/2:${PHOTO_BOX.top}+(${PHOTO_BOX.h}-h)/2`;
  } else if (c.wide?.length) {
    // wide shot → a 4:5 window (following faces / centred), large in the middle, blurred copy behind it
    const x = `max(0,min(iw-ow,(${keyExpr(c.wide)})*iw-ow/2))`;
    g = `${src}split[b${i}][f${i}];[b${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2,eq=brightness=-0.1[bb${i}];` +
      `[f${i}]crop=w='min(iw,ih*0.8)':h=ih:x='${x}':y=0,scale=${W}:-2[ff${i}];[bb${i}][ff${i}]overlay=0:(H-h)/2`;
  } else if (c.crop?.length) {
    const x = `max(0,min(iw-ow,(${keyExpr(c.crop)})*iw-ow/2))`;
    g = `${src}crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':x='${x}':y='(ih-oh)/2',scale=${W}:${H}`;
  } else if (c.isImage) {
    g = `${src}split[b${i}][f${i}];[b${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2,eq=brightness=-0.12[bb${i}];` +
      `[f${i}]scale=${PHOTO_BOX.w}:${PHOTO_BOX.h}:force_original_aspect_ratio=decrease[ff${i}];[bb${i}][ff${i}]overlay=(W-w)/2:${PHOTO_BOX.top}+(${PHOTO_BOX.h}-h)/2,` +
      `fps=30,scale=${W * 2}:${H * 2},zoompan=z='min(1+on*0.0005,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=30`;
  } else {
    g = `${src}split[b${i}][f${i}];[b${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2[bb${i}];` +
      `[f${i}]scale=${W}:${H}:force_original_aspect_ratio=decrease[ff${i}];[bb${i}][ff${i}]overlay=(W-w)/2:(H-h)/2`;
  }
  if (c.punch) {
    const { z, cx = 0.5, cy = 0.45 } = c.punch, zw = even(W * z), zh = even(H * z);
    const x = Math.round(clampN(cx * zw - W / 2, 0, zw - W)), y = Math.round(clampN(cy * zh - H / 2, 0, zh - H));
    g += `,scale=${zw}:${zh},crop=${W}:${H}:${x}:${y}`;
  }
  return `${g},setsar=1,${c.speed && c.speed < 1 ? "minterpolate=fps=30:mi_mode=blend" : "fps=30"},format=yuv420p,settb=AVTB[v${i}]`;
}

/**
 * clips: [{file, start, dur, isImage, hasAudio, voice, denoise, mute, shot, look, brighten, crop, punch}] → out.mp4 with ass burned in.
 * Pieces of the same shot are joined with hard cuts (jump cuts); between shots `joins[k]` = {type (xfade name), d} or null (cut).
 * opts.music: {file, startAt, volume, duck} · opts.sfx: [{file, at, volume}] · opts.total: final length (s)
 * Audio: speech is cleaned (denoised only when noisy), its own soundtrack is muted under our music, music ducks under the voice, sound effects on top, whole mix normalised to -14 LUFS (Instagram level).
 * cwd = the job folder (keeps every path in the filter relative, which avoids Windows "C:" escaping issues).
 */
export async function renderReel(cwd, clips, assFile, outFile, opts = {}) {
  const { music, sfx = [], joins = [], total } = opts;
  const args = [];
  let nextIn = 0;
  const input = (...a) => (args.push(...a), nextIn++);
  clips.forEach((c) => {
    if (c.card) input("-f", "lavfi", "-t", c.dur.toFixed(3), "-i", `color=c=${c.card}:s=${W}x${H}:r=30`);
    else if (c.isImage) input("-loop", "1", "-t", c.dur.toFixed(3), "-i", c.file);
    else input("-ss", c.start.toFixed(3), "-t", (c.dur * (c.speed || 1)).toFixed(3), "-i", c.file);
  });
  // silent audio for clips without sound, so every piece has an audio stream
  const silentIdx = {};
  clips.forEach((c, i) => {
    if (c.card || c.isImage || !c.hasAudio || (c.speed && c.speed !== 1)) silentIdx[i] = input("-f", "lavfi", "-t", c.dur.toFixed(3), "-i", "anullsrc=r=44100:cl=stereo");
  });
  const musicIdx = music ? input("-stream_loop", "-1", "-ss", music.startAt.toFixed(3), "-i", music.file) : -1;
  const sfxIdx = sfx.map((s) => input("-i", s.file));
  const { stickers = [], leaks = [] } = opts;
  const leakIdx = leaks.map((l) => input("-i", l.file));
  const stickerIdx = stickers.map((s) => input("-loop", "1", "-framerate", "30", "-t", (s.end + 0.5).toFixed(2), "-i", s.file));

  const g = clips.map((c, i) => {
    // speech only: cut rumble below 80 Hz (+ gentle FFT noise reduction when the recording is measurably noisy)
    // + "radio voice": de-esser, gentle compression (even loudness), less mud at 180 Hz, more presence at 3.2 kHz
    // anything else (film mix, music, ambience) passes untouched, or is muted when our music replaces it
    const mute = c.mute ? "volume=0," : "";
    const clean = c.voice && !c.mute
      ? `highpass=f=80,${c.denoise ? "afftdn=nf=-25," : ""}deesser=i=0.4,acompressor=threshold=0.1:ratio=3:attack=10:release=200:makeup=2,equalizer=f=180:t=q:w=1:g=-2,equalizer=f=3200:t=q:w=1.4:g=3,`
      : "";
    return layout(i, c) + `;[${silentIdx[i] ?? i}:a]${clean}${mute}aresample=44100,aformat=channel_layouts=stereo,apad,atrim=0:${c.dur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`;
  });

  // shots: consecutive pieces of the same shot → hard cuts
  const shots = [];
  clips.forEach((c, i) => (i && c.shot === clips[i - 1].shot ? shots[shots.length - 1].push(i) : shots.push([i])));
  const shotLen = shots.map((s) => s.reduce((a, i) => a + clips[i].dur, 0));
  shots.forEach((s, k) => {
    if (s.length === 1) g.push(`[v${s[0]}]null[sv${k}];[a${s[0]}]anull[sa${k}]`);
    else g.push(`${s.map((i) => `[v${i}][a${i}]`).join("")}concat=n=${s.length}:v=1:a=1[svr${k}][sa${k}];[svr${k}]settb=AVTB[sv${k}]`);
  });
  // between shots: transition (xfade + audio crossfade) or a plain cut
  let cv = "[sv0]", ca = "[sa0]", len = shotLen[0];
  for (let k = 1; k < shots.length; k++) {
    const j = joins[k - 1];
    if (j && j.d >= 0.1) {
      g.push(`${cv}[sv${k}]xfade=transition=${j.type}:duration=${j.d.toFixed(3)}:offset=${(len - j.d).toFixed(3)}[xv${k}];${ca}[sa${k}]acrossfade=d=${j.d.toFixed(3)}[xa${k}]`);
      len += shotLen[k] - j.d;
    } else {
      g.push(`${cv}${ca}[sv${k}][sa${k}]concat=n=2:v=1:a=1[xvr${k}][xa${k}];[xvr${k}]settb=AVTB[xv${k}]`);
      len += shotLen[k];
    }
    cv = `[xv${k}]`;
    ca = `[xa${k}]`;
  }
  const T = (total ?? len).toFixed(3);
  const fontsDir = path.relative(cwd, FONT_DIR).replace(/\\/g, "/");
  // light leaks: placed on a black canvas at their times, then "screen" blended (black = no change, light = glow)
  if (leaks.length) {
    g.push(`color=c=black:s=${W}x${H}:r=30:d=${T},format=yuv420p[lc0]`);
    leaks.forEach((l, k) => g.push(`[${leakIdx[k]}:v]fps=30,format=yuv420p,setpts=PTS-STARTPTS+${l.start.toFixed(3)}/TB[lv${k}];[lc${k}][lv${k}]overlay=eof_action=pass[lc${k + 1}]`));
    g.push(`${cv}format=gbrp[vg];[lc${leaks.length}]format=gbrp[lg];[vg][lg]blend=all_mode=screen:all_opacity=0.75,format=yuv420p[vlk]`);
    cv = "[vlk]";
  }
  // stickers: colour emoji that drop in with a damped bounce and fade out (under the texts, so texts stay readable)
  stickers.forEach((s, k) => {
    const a = s.start.toFixed(3), dt = `max(0,t-${a})`;
    // still = brand watermark: no bounce, semi-transparent
    const y = s.still ? `${Math.round(s.y)}-h/2` : `${Math.round(s.y)}-h/2-90*exp(-7*${dt})*cos(14*${dt})`;
    const alpha = s.opacity ? `,colorchannelmixer=aa=${s.opacity}` : "";
    g.push(`[${stickerIdx[k]}:v]scale=${Math.round(s.size)}:-1,format=rgba${alpha},fade=t=in:st=${a}:d=0.15:alpha=1,fade=t=out:st=${(s.end - 0.25).toFixed(3)}:d=0.25:alpha=1[sp${k}];` +
      `${cv}[sp${k}]overlay=x='${Math.round(s.x)}-w/2':y='${y}':enable='between(t,${a},${s.end.toFixed(3)})':eval=frame[vst${k}]`);
    cv = `[vst${k}]`;
  });
  // film finish (cinematic recipe): fine moving grain + a soft vignette over the whole reel, under the text
  if (opts.film) {
    g.push(`${cv}noise=alls=9:allf=t,vignette=PI/5[vfilm]`);
    cv = "[vfilm]";
  }
  g.push(`${cv}subtitles=${assFile}:fontsdir=${fontsDir}[outv]`);

  // audio mix: voice (+ music ducked under it) (+ sound effects) → loudness normalisation
  const mix = [ca];
  if (music) {
    const fadeAt = Math.max(0, +T - 1.2).toFixed(3);
    // dips: the music drops to ~10% for a moment right before a big reveal (silence before the hit)
    const dips = (music.dips || []).filter(([a, b]) => b > 0).map(([a, b]) => `between(t,${Math.max(0, a).toFixed(2)},${b.toFixed(2)})`);
    const dip = dips.length ? `,volume='if(${dips.join("+")},0.1,1)':eval=frame` : "";
    g.push(`[${musicIdx}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${T},asetpts=PTS-STARTPTS,volume=${music.volume}${dip},afade=t=in:d=0.3,afade=t=out:st=${fadeAt}:d=1.2[mus]`);
    if (music.duck) {
      // the voice drives a compressor on the music: music dips while someone talks, comes back in the pauses
      g.push(`${ca}asplit[voice][key];[mus][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[musd]`);
      mix.splice(0, 1, "[voice]", "[musd]");
    } else mix.push("[mus]");
  }
  sfx.forEach((s, k) => {
    const ms = Math.max(0, Math.round(s.at * 1000));
    // real sound files can be long: keep max 1.5 s with a soft tail
    g.push(`[${sfxIdx[k]}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:1.5,afade=t=out:st=1.1:d=0.4,volume=${s.volume ?? 0.5},adelay=${ms}|${ms}[fx${k}]`);
    mix.push(`[fx${k}]`);
  });
  const mixed = mix.length > 1 ? `${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0,` : `${mix[0]}anull,`;
  g.push(`${mixed}atrim=0:${T},aresample=44100[outa]`);

  // the graph is kept next to the output: tests assert on it, and it explains any odd render later
  fs.writeFileSync(path.join(cwd, "render-filter.txt"), g.join(";\n"));
  // pass 1: picture + lossless audio; pass 2: one fixed gain to -14 LUFS + a true-peak limiter (video copied).
  // A fixed gain keeps the mix's own dynamics: single-pass loudnorm rides the level and pumps on music.
  const pre = `pre-${path.parse(outFile).name}.mkv`;
  await ffmpeg([...args, "-filter_complex", g.join(";"), "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "pcm_s16le", pre], cwd);
  const { i } = await loudnessOf(path.join(cwd, pre));
  const gain = Number.isFinite(i) && i > -60 ? Math.max(-20, Math.min(20, LUFS - i)) : 0;
  // The limiter runs at the mix's own rate (limiting at 4x and resampling back made the resampler ring up to +3 dB
  // over the ceiling) and without `latency=1` (with it, AAC came out 1.3 dB hotter on the same audio).
  const pass2 = (ceil) => ffmpeg(["-i", pre, "-map", "0:v", "-map", "0:a", "-c:v", "copy",
    "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=${Math.pow(10, ceil / 20).toFixed(3)}:level=false`,
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outFile], cwd);
  // checked, not trusted: hard limiting (a peaky mix pushed up 10 dB) makes AAC overshoot the sample ceiling between
  // samples. If the true peak is above -1 dBTP, the ceiling goes down by the overshoot (max 2 retries).
  let ceil = PEAK_DB;
  await pass2(ceil);
  for (let k = 0; k < 2; k++) {
    const { tp } = await loudnessOf(path.join(cwd, outFile));
    if (!(tp > -1)) break;
    ceil -= tp + 1 + 0.3;
    console.warn(`true peak ${tp} dBTP (gain ${gain.toFixed(1)} dB) → limiter ceiling ${ceil.toFixed(1)} dB`);
    await pass2(ceil);
  }
  if (process.env.KEEP_PRE) fs.copyFileSync(path.join(cwd, pre), path.resolve(process.env.KEEP_PRE));
  fs.rmSync(path.join(cwd, pre), { force: true });
  if (!fs.existsSync(path.join(cwd, outFile))) throw new Error("ffmpeg: video was not created");
}

// Instagram / Shorts level, and the limiter ceiling (sample peak; between-sample peaks + AAC add ~1 dB → ≤ -1 dBTP)
export const LUFS = -14, PEAK_DB = -2.5;

/** Integrated loudness (LUFS), loudness range (LU) and true peak (dBTP) of a file's audio (EBU R128). */
export async function loudnessOf(file) {
  const log = await ffmpegScan(["-i", file, "-vn", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], /\b(I|LRA|Peak):\s/);
  const last = (re) => +(([...log.matchAll(re)].pop() || [])[1] ?? NaN);
  return { i: last(/\bI:\s+(-?[\d.]+) LUFS/g), lra: last(/\bLRA:\s+(-?[\d.]+) LU/g), tp: last(/\bPeak:\s+(-?[\d.]+) dBFS/g) };
}

/** Cover image: one frame in the same 9:16 layout + look, with the cover text on it. c = {file, start, isImage, look, brighten, crop} */
export async function renderCover(cwd, c, assFile, outFile) {
  const fontsDir = path.relative(cwd, FONT_DIR).replace(/\\/g, "/");
  // a still image must be looped, or the fps filter in the layout drops its only frame
  const input = c.isImage ? ["-loop", "1", "-t", "1", "-i", c.file] : ["-ss", c.start.toFixed(2), "-i", c.file];
  await ffmpeg([...input, "-filter_complex", `${layout(0, { ...c, punch: null })};[v0]subtitles=${assFile}:fontsdir=${fontsDir}[o]`, "-map", "[o]", "-frames:v", "1", "-q:v", "3", outFile], cwd);
  if (!fs.existsSync(path.join(cwd, outFile))) throw new Error("ffmpeg: cover was not created");
}

export const jobDir = (id) => {
  const d = path.resolve(process.env.DATA_DIR || "data", "jobs", id);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
