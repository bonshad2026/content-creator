// Video job: inputs (videos/photos) → AI edit plan → 9:16 reel with on-screen text + subtitles + cover.
// The AI only sees a few small frames + the transcript (cheap); the heavy work is ffmpeg on this computer.
import fs from "node:fs";
import path from "node:path";
import { probe, frameAt, extractAudio, detectSilences, sceneChanges, contactSheet, detectBars, sfxLibrary, ensureRisers, colorStats, autoCorrect, matchFilter, LOOKS, TRANSITIONS, TEXT_ANIMS, PHOTO_BOX, SAFE, STICKER_DIR, listStickers, leakFile, transitionLength, buildAss, renderReel, renderCover, jobDir, W, H } from "./media.js";
import { pickRecipe, recipeTransitions, recipeAnim } from "./recipes.js";
import { transcribe, planReel } from "./ai.js";
import { listMoods, pickTrack } from "./music.js";
import { faceTrack } from "./vision.js";

/** k frame times for a video: one in the middle of each shot (longest shots first), extra frames to the longest shots. */
function frameTimes(dur, cuts, k) {
  const b = [0, ...cuts.filter((t) => t > 0.3 && t < dur - 0.3), dur];
  let segs = b.slice(1).map((e, i) => ({ s: b[i], e }));
  if (segs.length > k) segs = [...segs].sort((x, y) => y.e - y.s - (x.e - x.s)).slice(0, k).sort((x, y) => x.s - y.s);
  const count = segs.map(() => 1);
  for (let r = segs.length; r < k; r++) {
    let best = 0;
    segs.forEach((g, i) => {
      if ((g.e - g.s) / (count[i] + 1) > (segs[best].e - segs[best].s) / (count[best] + 1)) best = i;
    });
    count[best]++;
  }
  return segs.flatMap((g, i) => Array.from({ length: count[i] }, (_, j) => Math.min(dur - 0.1, g.s + ((g.e - g.s) * (j + 0.5)) / count[i])));
}

/** Split pieces of input n at [a, b] (source time) so that stretch can be zoomed; tiny leftovers are not split off. */
function splitFor(pieces, n, a, b) {
  return pieces.flatMap((p) => {
    const e = p.start + p.dur;
    if (p.inp.n !== n || b <= p.start || a >= e) return [p];
    let s1 = Math.max(a, p.start), s2 = Math.min(b, e);
    if (s1 - p.start < 0.35) s1 = p.start;
    if (e - s2 < 0.35) s2 = e;
    if (s2 - s1 < 0.5) return [p];
    return [
      s1 > p.start && { ...p, dur: s1 - p.start },
      { ...p, start: s1, dur: s2 - s1, emph: true },
      s2 < e && { ...p, start: s2, dur: e - s2 },
    ].filter(Boolean);
  });
}

const FRAME_BUDGET = 8; // total frames sent to the AI per reel
const IMAGE_SEC = 3;
const PAD = 0.12; // jump cuts keep this much of each pause, so words never get clipped

// one ffmpeg render at a time (CPU heavy); AI calls of other jobs keep running meanwhile
let renderChain = Promise.resolve();
const exclusive = (fn) => (renderChain = renderChain.then(fn, fn));

/**
 * Time every word of a (possibly AI-corrected) line. Whisper's own word times are used when they line up
 * one-to-one and look sane; otherwise words share the line's time by their length (Persian word times are often rough).
 */
function timeWords(seg, text) {
  const words = text.split(/\s+/).filter(Boolean);
  const raw = seg.words || [];
  if (raw.length === words.length && raw.every((w) => w.end - w.start >= 0.06))
    return words.map((t, i) => ({ start: raw[i].start, end: raw[i].end, text: t }));
  const total = words.reduce((a, w) => a + w.length + 1, 0);
  let t = seg.start;
  return words.map((w) => {
    const d = ((seg.end - seg.start) * (w.length + 1)) / total;
    const r = { start: t, end: t + d, text: w };
    t += d;
    return r;
  });
}

// karaoke lines: ≤3 words on screen, a new line after a sentence end or a pause,
// and the words of a sentence spread evenly (4 words → 2+2, not 3+1)
function chunkWords(words, max = 3) {
  const sentences = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (!next || /[.!?؟،,…]$/.test(w.text) || next.start - w.end > 0.5) sentences.push(cur), (cur = []);
  });
  const out = [];
  for (const s of sentences) {
    const n = Math.ceil(s.length / max);
    for (let k = 0, i = 0; k < n; k++) {
      const size = Math.ceil((s.length - i) / (n - k));
      out.push(s.slice(i, i + size));
      i += size;
    }
  }
  return out.map((ws) => ({ start: ws[0].start, end: ws[ws.length - 1].end, words: ws }));
}

/** Split a video clip at its pauses (jump cuts). Never cuts inside a spoken word. */
function jumpCut(clip, silences, words) {
  const a = clip.start, b = clip.start + clip.dur;
  const cuts = silences
    .map(([s, e]) => [Math.max(a, s + (s <= a ? 0 : PAD)), Math.min(b, e - (e >= b ? 0 : PAD))])
    // the measured silence wins, except where a word with believable timing sits in the middle of it
    // (Whisper often stretches a word's end over the pause after it, so long words are ignored)
    .filter(([s, e]) => e - s >= 0.25 && !words.some((w) => w.end - w.start >= 0.06 && w.end - w.start <= 0.7 && (w.start + w.end) / 2 > s && (w.start + w.end) / 2 < e));
  const pieces = [];
  let t = a;
  for (const [s, e] of cuts) {
    if (s - t >= 0.2) pieces.push({ ...clip, start: t, dur: s - t });
    t = Math.max(t, e);
  }
  if (b - t >= 0.2) pieces.push({ ...clip, start: t, dur: b - t });
  const kept = pieces.reduce((x, p) => x + p.dur, 0);
  return pieces.length && kept >= Math.min(1, clip.dur) ? pieces : [clip];
}

/**
 * Move transcript lines whose times fall in measured silence onto the nearest stretch of real sound.
 * Lines that share a stretch are spread over it by their length; their (unreliable) word times are dropped.
 */
function retime(segs, silences, dur) {
  const regions = [];
  let t = 0;
  for (const [a, b] of silences) {
    if (a - t > 0.15) regions.push([t, a]);
    t = Math.min(b, dur);
  }
  if (dur - t > 0.15) regions.push([t, dur]);
  if (!regions.length || !segs.length) return;
  const overlap = (s, r) => Math.max(0, Math.min(s.end, r[1]) - Math.max(s.start, r[0]));
  const gap = (s, r) => Math.max(0, r[0] - s.end, s.start - r[1]);
  const groups = new Map();
  for (const s of segs) {
    let best = regions[0];
    for (const r of regions) if (overlap(s, r) > overlap(s, best) || (overlap(s, best) === 0 && gap(s, r) < gap(s, best))) best = r;
    s._in = overlap(s, best) / Math.max(0.01, s.end - s.start);
    groups.set(best, [...(groups.get(best) || []), s]);
  }
  for (const [r, g] of groups) {
    const fine = g.every((s) => s._in >= 0.6);
    for (const s of g) delete s._in;
    if (fine) continue;
    const a = Math.max(r[0], Math.min(r[1], g[0].start));
    const b = Math.min(r[1], Math.max(g[g.length - 1].end, a + 0.35 * g.length));
    const total = g.reduce((x, s) => x + s.text.length, 0) || 1;
    let at = a;
    for (const s of g) {
      const d = ((b - a) * s.text.length) / total;
      Object.assign(s, { start: at, end: at + d, words: [] });
      at += d;
    }
  }
}

/** A length the creator asked for in the brief ("یک دقیقه‌ای", "۳۰ ثانیه", "45 sec") → seconds, or null. */
export function targetSeconds(brief = "") {
  const b = String(brief).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  let m, sec = null;
  if ((m = b.match(/(\d+(?:\.\d+)?)\s*(?:ثانیه|sec|second)/i))) sec = +m[1];
  else if ((m = b.match(/(\d+(?:\.\d+)?)\s*(?:دقیقه|min)/i))) sec = +m[1] * 60;
  else if (/نیم\s*دقیقه|half a minute/i.test(b)) sec = 30;
  else if (/(یک|یه)\s*دقیقه|one minute|a minute/i.test(b)) sec = 60;
  return sec ? Math.max(5, Math.min(90, sec)) : null;
}

export async function runReel(job, profileText, setStage, manual = null) {
  const dir = jobDir(job.id);
  const url = (f) => `/media/${job.id}/${f}`;
  const usage = { tokens: 0, cost: 0 };

  // 1) look at the inputs
  setStage("analyzing");
  const inputs = [];
  for (const inp of job.inputs) {
    const file = path.join(dir, inp.file);
    // (photo size is needed to place arrows/circles on it)
    if (inp.type === "image") inputs.push({ ...inp, ...(await probe(file).catch(() => ({}))), duration: IMAGE_SEC, hasAudio: false });
    else inputs.push({ ...inp, ...(await probe(file)) });
  }
  const videos = inputs.filter((i) => i.type === "video");
  const totalVideo = videos.reduce((a, v) => a + v.duration, 0) || 1;
  for (const inp of inputs) {
    const file = path.join(dir, inp.file);
    const k = inp.type === "image" ? 1 : Math.max(2, Math.min(5, Math.round((inp.duration / totalVideo) * (FRAME_BUDGET - (inputs.length - videos.length)))));
    // same number of frames as before, but one per shot (scene detection) instead of at fixed intervals
    inp.scenes = inp.type === "video" ? await sceneChanges(file) : [];
    const times = inp.type === "image" ? [0] : frameTimes(inp.duration, inp.scenes, k);
    inp.frames = [];
    // long video: a timestamped contact sheet of the whole thing (12-30 moments, one per ~10 s, at shot changes)
    // instead of 5 lonely frames, so the AI can choose from all of it, not just what it happened to see
    if (inp.type === "video" && inp.duration > 60) {
      // evenly spaced (not per shot): the sheet's job is to cover the WHOLE video; the shot-change list says where the cuts are
      const sheetN = Math.max(12, Math.min(30, Math.round(inp.duration / 10)));
      const sheetTimes = Array.from({ length: sheetN }, (_, i) => ((i + 0.5) * inp.duration) / sheetN);
      const sheet = await contactSheet(dir, inp.file, sheetTimes, `sheet${inp.n}.jpg`, inp.height > inp.width);
      inp.sheet = { count: sheetTimes.length, b64: fs.readFileSync(sheet).toString("base64") };
      await frameAt(file, sheetTimes[0], path.join(dir, `f${inp.n}-0.jpg`));
      continue;
    }
    for (let j = 0; j < times.length; j++) {
      const t = times[j];
      const out = path.join(dir, `f${inp.n}-${j}.jpg`);
      await frameAt(file, t, out);
      inp.frames.push({ t, b64: fs.readFileSync(out).toString("base64") });
    }
  }
  fs.copyFileSync(path.join(dir, `f${inputs[0].n}-0.jpg`), path.join(dir, "thumb.jpg"));
  job.thumb = url("thumb.jpg");

  // 2) speech → text (only videos with audio, max 5 min total)
  const transcript = [];
  let spokenLang = "";
  let budget = 300;
  // context for speech-to-text: topic + niche + words creators often say
  const niche = (profileText.match(/^Niche: (.*)$/m) || [])[1] || "";
  const hint = [job.brief, niche, "دانلود، اپلیکیشن، بازی، لینک تو بیو، کامنت، پیج، فالو، لایک، سیو"].filter(Boolean).join(". ");
  // manual mode (manual = {plan, transcript}): an edit plan written by hand, no AI / speech-to-text calls at all
  if (manual) {
    for (const s of manual.transcript || []) transcript.push({ words: [], ...s });
    for (const v of videos) v.hasSpeech = transcript.some((s) => s.n === v.n);
    spokenLang = manual.spokenLang || (transcript.length ? "persian" : "");
  }
  for (const v of manual ? [] : videos.filter((v) => v.hasAudio)) {
    if (budget <= 0) break;
    try {
      const audio = await extractAudio(path.join(dir, v.file), path.join(dir, `a${v.n}.mp3`), budget);
      const r = await transcribe(audio, hint);
      usage.cost += r.cost;
      r.segments.forEach((s) => transcript.push({ n: v.n, ...s }));
      v.hasSpeech = r.segments.length > 0;
      if (v.hasSpeech && !spokenLang) spokenLang = r.language;
    } catch (e) {
      console.warn("transcribe failed:", e.message);
    }
    budget -= v.duration;
  }

  // clean up the speech-to-text result (local, free):
  // a) Whisper sometimes "hears" the hint words themselves on music / silence → drop lines made only of hint words
  if (!manual) {
    const strip = (w) => w.replace(/[.,!?؟،…:;"'«»]/g, "");
    const hintWords = new Set(hint.split(/\s+/).map(strip).filter(Boolean));
    for (let i = transcript.length - 1; i >= 0; i--) {
      const ws = transcript[i].text.split(/\s+/).map(strip).filter(Boolean);
      if (!ws.length || ws.every((w) => hintWords.has(w))) transcript.splice(i, 1);
    }
    // garbage: on music / fight noise Whisper loops one phrase ("x y x y x y…"). Such lines are dropped, and when
    // half the lines or more are like that, the whole transcript is unreliable → treated as "no speech"
    const looped = (s) => {
      const ws = s.text.split(/\s+/).map(strip).filter(Boolean);
      return ws.length >= 8 && new Set(ws).size / ws.length < 0.34;
    };
    const bad = transcript.filter(looped).length;
    if (bad && bad >= transcript.length / 2) transcript.length = 0;
    else for (let i = transcript.length - 1; i >= 0; i--) if (looped(transcript[i])) transcript.splice(i, 1);
    for (const v of videos) v.hasSpeech = transcript.some((s) => s.n === v.n);
    if (!transcript.length) spokenLang = "";
  }
  // b) line times that sit in measured silence are moved onto the real sound (Whisper's timing can be off by a second)
  const silencesOf = {};
  for (const v of videos.filter((v) => v.hasSpeech)) {
    silencesOf[v.n] = await detectSilences(path.join(dir, v.file)).catch(() => []);
    retime(transcript.filter((s) => s.n === v.n), silencesOf[v.n], v.duration);
  }

  // 3) one AI call: post text + edit plan (manual = a ready plan: hand-written in tests, or the revised plan of a "revise")
  setStage("writing");
  const moods = listMoods();
  const { data: plan, usage: u } = manual
    ? { data: manual.plan, usage: { tokens: 0, cost: 0 } }
    : await planReel(profileText, inputs, transcript, job.brief, spokenLang, moods, targetSeconds(job.brief));
  usage.tokens += u.tokens;
  usage.cost += u.cost;
  // subtitles: the AI's corrected (or translated) lines, with the original timings; raw speech-to-text as fallback
  const fixed = Array.isArray(plan.subs) && transcript.length > 0 && plan.subs.length === transcript.length && plan.subs.every((x) => typeof x === "string" && x.trim());
  if (transcript.length && !fixed) console.warn(`subs not usable (${plan.subs?.length} for ${transcript.length} lines), using raw transcript`);
  const subSource = fixed ? transcript.map((s, i) => ({ ...s, text: plan.subs[i].trim() })) : transcript;
  // word-by-word timing (karaoke); a translated line gets its timing spread over the original line
  for (const s of subSource) s.timed = timeWords(s, s.text);

  // the editing recipe (one word from the AI) decides the house rules below
  const recipe = pickRecipe(plan.recipe, { hasSpeech: videos.some((v) => v.hasSpeech), onlyPhotos: !videos.length });
  // screen recordings / app & game UI: shown framed (smaller, with a border), never cropped or colour-"fixed"
  const framed = new Set((Array.isArray(plan.framed) ? plan.framed : []).map(Number));
  // fallback: a phone screen recording is taller than any camera video (≈ 9:19.5 vs 9:16) → treat it as one too
  for (const v of videos) if (v.height / v.width >= 1.9) framed.add(v.n);
  const brand = job.brand || {};

  // 4) sanitize the plan
  const byN = Object.fromEntries(inputs.map((i) => [i.n, i]));
  const maxStill = inputs.length > 1 ? recipe.maxStill + 0.5 : 8;
  let clips = (plan.clips || [])
    .map((c) => {
      const inp = byN[c.n];
      if (!inp) return null;
      if (inp.type === "image") return { inp, start: 0, dur: Math.min(maxStill, Math.max(1.5, (+c.e || IMAGE_SEC) - (+c.s || 0))) };
      const s = Math.max(0, Math.min(+c.s || 0, inp.duration - 0.5));
      const e = Math.min(inp.duration, Math.max(+c.e || 0, s + 0.6));
      // x = where the subject is (0-1) when it's off-centre and there's no face to follow
      // speed: <1 slow motion, >1 speed-up (only clips without speech; they play silent). The clip lasts (e-s)/speed.
      const speed = !inp.hasSpeech && c.speed >= 0.3 && c.speed <= 3 ? +c.speed : 1;
      return { inp, start: s, dur: (e - s) / speed, speed, fx: c.x >= 0 && c.x <= 1 ? +c.x : null };
    })
    .filter(Boolean);
  if (!clips.length) clips = [{ inp: inputs[0], start: 0, dur: Math.min(20, inputs[0].duration) }];
  let planned = 0;
  clips = clips.filter((c) => (planned + c.dur <= 90 ? ((c.offset = planned), (planned += c.dur), true) : false));
  clips.forEach((c, i) => (c.id = i));

  // 5) jump cuts: drop the pauses inside clips that have speech (local ffmpeg, no AI)
  const wordsOf = (n) => transcript.filter((s) => s.n === n).flatMap((s) => s.words || []);
  let pieces = [];
  let jumpCuts = 0;
  for (const c of clips) {
    const parts = c.inp.type === "video" && silencesOf[c.inp.n] ? jumpCut(c, silencesOf[c.inp.n], wordsOf(c.inp.n)) : [c];
    jumpCuts += parts.length - 1;
    // every other piece of a jump-cut clip gets a slight zoom, the classic talking-head trick
    parts.forEach((p, k) => pieces.push({ ...p, alt: parts.length > 1 && k % 2 === 1 }));
  }

  // key sentences picked by the AI → that stretch is split off and gets a stronger punch-in + an impact sound
  const emphasis = (Array.isArray(plan.emphasis) ? plan.emphasis : []).map(Number).filter((i) => transcript[i]).slice(0, 3);
  // (a long line is zoomed for its first 4 s only: a zoom works as an accent, not as a new framing)
  for (const i of emphasis) pieces = splitFor(pieces, transcript[i].n, transcript[i].start, Math.min(transcript[i].end, transcript[i].start + 4));

  // brand outro: a 1.6 s card (logo + handle + call to action) at the very end
  const OUTRO = 1.6;
  if (brand.outro) pieces.push({ inp: { n: 0, type: "card", duration: OUTRO, hasAudio: false }, start: 0, dur: OUTRO, id: "outro" });

  // transitions between shots: the AI's picks, cleaned up by the recipe (family, no 3× the same); same continuous take → cut
  const shotStarts = pieces.map((p, i) => i > 0 && p.id !== pieces[i - 1].id).map((x, i) => (x ? i : -1)).filter((i) => i > 0);
  const wanted = recipeTransitions(recipe, Array.isArray(plan.transitions) ? plan.transitions : [], shotStarts.length, Object.keys(TRANSITIONS))
    // cinematic: hard cuts (a soft fade / dip / blur is allowed), never whips or wipes
    .map((t) => (recipe.minimal && !["cut", "fade", "dip", "blur"].includes(t) ? "cut" : t));
  const joinName = shotStarts.map((i, k) => {
    const a = pieces[i - 1], b = pieces[i];
    if (b.id === "outro") return recipe.calm ? "dip" : "fade";
    const continuous = a.inp.n === b.inp.n && Math.abs(a.start + a.dur - b.start) < 0.05;
    return continuous ? "cut" : wanted[k];
  });
  const joinAt = (i) => shotStarts.indexOf(i); // piece index → join number (-1 if no shot change there)

  // 6) music: the AI's mood (or the recipe's when it didn't say; "none" = no music); cuts between shots snap to the beat
  const mood = plan.music === "none" ? null : moods.includes(plan.music) ? plan.music : moods.includes(recipe.music) ? recipe.music : null;
  const track = mood ? await pickTrack(mood).catch((e) => (console.warn("music:", e.message), null)) : null;
  const startAt = track?.beats?.[0] || 0;
  const beats = (track?.beats || []).map((b) => b - startAt).filter((b) => b > 0.3);
  if (beats.length) {
    let t = 0;
    pieces.forEach((p, i) => {
      const k = joinAt(i);
      if (k >= 0) t -= transitionLength(joinName[k]);
      const next = pieces[i + 1];
      const shotChange = !next || next.id !== p.id;
      const speechy = p.inp.type === "video" && p.inp.hasSpeech;
      if (shotChange && !speechy && p.id !== "outro") {
        // the middle of the transition lands on the beat
        const d = next ? transitionLength(joinName[joinAt(i + 1)]) : 0;
        const end = t + p.dur - d / 2;
        const beat = beats.reduce((x, b) => (Math.abs(b - end) < Math.abs(x - end) ? b : x), beats[0]);
        const nd = p.dur + (beat - end);
        const fits = p.inp.type === "image" ? nd >= 1.2 && nd <= 8 : nd >= 0.6 && p.start + nd * (p.speed || 1) <= p.inp.duration;
        if (Math.abs(beat - end) <= 0.4 && fits) p.dur = nd;
      }
      t += p.dur;
    });
  }
  // final transition lengths (never longer than half of either shot) and the final timeline (transitions overlap)
  const shotLen = (i) => {
    let s = 0;
    for (let j = i; j < pieces.length && pieces[j].id === pieces[i].id; j++) s += pieces[j].dur;
    return s;
  };
  const shotLenBack = (i) => {
    let s = 0;
    for (let j = i; j >= 0 && pieces[j].id === pieces[i].id; j--) s += pieces[j].dur;
    return s;
  };
  const joins = shotStarts.map((i, k) => {
    const tr = TRANSITIONS[joinName[k]];
    if (!tr) return null;
    const d = Math.min(tr[1], shotLenBack(i - 1) / 2, shotLen(i) / 2);
    return d >= 0.1 ? { type: tr[0], d, name: joinName[k] } : null;
  });
  let total = 0;
  pieces.forEach((p, i) => {
    const k = joinAt(i);
    if (k >= 0 && joins[k]) total -= joins[k].d;
    p.offset = total;
    total += p.dur;
  });
  const outro = pieces.find((p) => p.id === "outro");
  const contentEnd = outro ? outro.offset : total; // texts / stickers of the video itself end before the outro card
  if (process.env.DEBUG_REEL)
    console.log("recipe", recipe.name, "\nsilences", JSON.stringify(silencesOf), "\npieces", pieces.map((p) => `#${p.id} in${p.inp.n} ${p.start.toFixed(2)}+${p.dur.toFixed(2)}${p.alt ? " alt" : ""}${p.emph ? " EMPH" : ""}`).join(" | "), "\njoins", JSON.stringify(joins));

  // 7) faces (local): landscape clips with a person → real 9:16 crop following the face; punch-ins aim at the face
  const tracks = {};
  for (const inp of new Set(pieces.filter((p) => p.inp.type === "video" && !framed.has(p.inp.n)).map((p) => p.inp)))
    tracks[inp.n] = await faceTrack(path.join(dir, inp.file)).catch((e) => (console.warn("face tracking:", e.message), null));
  // full 9:16 crop: a face is in most of the shot AND there are enough pixels (otherwise the crop gets blurry when enlarged)
  const cropMode = (inp) =>
    inp.type === "video" && !framed.has(inp.n) && inp.width / inp.height > 0.8 && (tracks[inp.n]?.coverage || 0) >= 0.5 &&
    (inp.height >= 900 || inp.width / inp.height <= 1.8);
  // wide footage that can't be fully cropped (small faces, cinema 2.4:1, low resolution) → a big 4:5 window, following any
  // faces found (or centred), instead of a thin strip in the middle of a blurred background
  const WIDE_A = 0.8;
  const wideMode = (inp) => inp.type === "video" && !framed.has(inp.n) && inp.width / inp.height >= 1.5 && !cropMode(inp);
  const cropKeys = (inp, start, dur, fx, speed = 1) => {
    const keys = [];
    for (let t = 0; t <= dur + 0.01; t += Math.min(1, Math.max(dur, 0.1))) keys.push({ t, v: tracks[inp.n]?.at(start + t * speed)?.cx ?? fx ?? 0.5 });
    return keys;
  };
  // where the face sits in the final 9:16 frame (0-1), for aiming a zoom
  const faceInFrame = (inp, t) => {
    const f = inp.type === "video" && tracks[inp.n]?.at(t);
    if (!f) return { cx: 0.5, cy: 0.42 };
    if (cropMode(inp)) {
      const cw = (inp.height * 9) / 16 / inp.width, left = Math.max(0, Math.min(1 - cw, f.cx - cw / 2));
      return { cx: (f.cx - left) / cw, cy: f.cy };
    }
    if (wideMode(inp)) {
      const cw = (inp.height * WIDE_A) / inp.width, left = Math.max(0, Math.min(1 - cw, f.cx - cw / 2)), wh = W / WIDE_A;
      return { cx: (f.cx - left) / cw, cy: ((H - wh) / 2 + f.cy * wh) / H };
    }
    const s = Math.min(W / inp.width, H / inp.height), fw = inp.width * s, fh = inp.height * s;
    return { cx: ((W - fw) / 2 + f.cx * fw) / W, cy: ((H - fh) / 2 + f.cy * fh) / H };
  };

  // 8) colour: clips are measured and matched (dark / dull / over-bright camera footage fixed), then one look for the reel
  const look = plan.look in LOOKS ? plan.look : "natural";
  const brighten = new Set((Array.isArray(plan.brighten) ? plan.brighten : []).map(Number));
  const auto = {};
  const stats = {};
  for (const inp of new Set(pieces.filter((p) => p.inp.type === "video" || p.inp.type === "image").map((p) => p.inp)))
{
    // measured on the part of the clip that is actually used
    const used = pieces.filter((p) => p.inp === inp), a = Math.min(...used.map((p) => p.start)), b = Math.max(...used.map((p) => p.start + p.dur * (p.speed || 1)));
    stats[inp.n] = await colorStats(path.join(dir, inp.file), inp.type === "image", a, b - a);
  }
  // camera footage only: screen recordings, UI and small graphics keep their designed colours
  const isCamera = (inp) => !framed.has(inp.n) && !(inp.type === "image" && inp.width < 500) && stats[inp.n]?.y >= 32;
  const camera = Object.keys(stats).map((n) => byN[n]).filter(isCamera);
  const median = (k) => {
    const v = camera.map((i) => stats[i.n][k]).filter((x) => x != null).sort((a, b) => a - b);
    return v.length ? (v[Math.floor((v.length - 1) / 2)] + v[Math.ceil((v.length - 1) / 2)]) / 2 : null;
  };
  // several camera clips → matched to each other (shot matching); a single one → only fixed if clearly off
  const target = camera.length >= 2 ? { y: Math.min(150, Math.max(90, median("y"))), sat: median("sat"), u: median("u"), v: median("v") } : null;
  for (const n of Object.keys(stats))
    auto[n] = !isCamera(byN[n]) ? "" : target ? matchFilter(stats[n], target) : autoCorrect(stats[n]);

  // planned timeline (what the AI saw) → final timeline (after jump cuts / beat snapping)
  const mapTime = (t) => {
    const c = clips.find((x) => t < x.offset + x.dur) || clips[clips.length - 1];
    const src = c.start + Math.max(0, t - c.offset) * (c.speed || 1);
    const own = pieces.filter((p) => p.id === c.id);
    const hit = own.find((p) => src < p.start + p.dur) || own[own.length - 1];
    return hit.offset + Math.max(0, Math.min(hit.dur, (src - hit.start) / (hit.speed || 1)));
  };
  const onBeat = (t) => {
    if (!beats.length) return t;
    const b = beats.reduce((x, y) => (Math.abs(y - t) < Math.abs(x - t) ? y : x), beats[0]);
    return Math.abs(b - t) <= 0.18 ? b : t;
  };
  const inSpeech = (t) => subSource.length > 0 && pieces.some((p) => p.inp.hasSpeech && t >= p.offset && t < p.offset + p.dur);

  const texts = (plan.texts || [])
    .map((t, i) => {
      let start = mapTime(Math.max(0, +t.t || 0));
      // texts land on the music's beat (when not over speech, where the voice sets the rhythm)
      if (recipe.onBeat || mood === "energetic") start = inSpeech(start) ? start : onBeat(start);
      // on photos / framed recordings the top band is kept free for text, so those texts go there (never over the content)
      const onBox = pieces.some((p) => (p.inp.type === "image" || framed.has(p.inp.n)) && start >= p.offset && start < p.offset + p.dur);
      return {
        start, end: Math.min(contentEnd, start + Math.max(0.8, +t.d || 2)), text: t.text,
        style: onBox ? "Top" : { center: "Center", bottom: "Bottom" }[t.pos] || "Top", anim: recipe.minimal ? "fade" : recipeAnim(recipe, t.anim, i, TEXT_ANIMS),
      };
    })
    .filter((t) => t.text && t.start < contentEnd - 0.3)
    .sort((a, b) => a.start - b.start);
  // HOOK RULE: something must be on screen from the very first frame — a text in the first 0.35 s (the first hook line if needed)
  if (!texts.length || texts[0].start > 0.35) {
    const hook = String(plan.hooks?.[0] || "").split(/\s+/).slice(0, 6).join(" ");
    if (hook) texts.unshift({ start: 0, end: Math.min(contentEnd, 2.4, texts[0]?.start ?? 9), text: hook, style: "Top", anim: recipe.minimal ? "fade" : "words" });
  } else if (texts[0].start < 0.7) texts[0].start = 0;
  // outro card: call to action + handle
  if (outro) {
    const cta = String(plan.cta || "").trim();
    if (cta) texts.push({ start: outro.offset + 0.15, end: total, text: cta, style: "Center", anim: "bounce" });
    if (brand.handle) texts.push({ start: outro.offset + 0.35, end: total, text: brand.handle, style: "Bottom", anim: "slide-up" });
  }
  // two texts in the same spot never overlap: the earlier one leaves when the next one arrives
  texts.forEach((t, i) => {
    const next = texts.slice(i + 1).find((x) => x.style === t.style);
    if (next && next.start < t.end) t.end = Math.max(t.start + 0.4, next.start - 0.05);
  });

  // karaoke subtitles on the final timeline (a line crossing a jump cut is split at the cut)
  const subs = [];
  if (plan.subtitles !== false)
    for (const p of pieces.filter((p) => p.inp.type === "video"))
      for (const seg of subSource.filter((s) => s.n === p.inp.n))
        for (const ch of chunkWords(seg.timed, recipe.minimal ? 6 : 3)) {
          const inside = ch.words.filter((w) => (w.start + w.end) / 2 >= p.start && (w.start + w.end) / 2 < p.start + p.dur);
          if (!inside.length) continue;
          const at = (x) => Math.max(0, Math.min(p.dur, x - p.start)) + p.offset;
          const words = inside.map((w) => ({ start: at(w.start), end: at(w.end), text: w.text }));
          if (words[words.length - 1].end - words[0].start > 0.2) subs.push({ start: words[0].start, end: words[words.length - 1].end, words, text: inside.map((w) => w.text).join(" ") });
        }
  // keep each line up until the next one starts when the gap is short (less flicker)
  subs.sort((a, b) => a.start - b.start).forEach((s, i) => {
    const n = subs[i + 1];
    s.end = n && n.start - s.end < 0.4 ? Math.max(s.end, n.start) : Math.min(contentEnd, s.end + 0.25);
  });

  // shapes (arrow / circle on something in an input's frame, countdown bar): AI gives x,y in the input's own frame (0-1),
  // here they're moved to where that point lands in the 9:16 output (fit / photo box / framed / face crop)
  const toFrame = (inp, t, x, y) => {
    if (!inp.width || !inp.height) return { x: x * W, y: y * H };
    if (inp.type === "image" || framed.has(inp.n)) {
      const s = Math.min(PHOTO_BOX.w / inp.width, PHOTO_BOX.h / inp.height), fw = inp.width * s, fh = inp.height * s;
      return { x: (W - fw) / 2 + x * fw, y: PHOTO_BOX.top + (PHOTO_BOX.h - fh) / 2 + y * fh };
    }
    if (cropMode(inp)) {
      const cw = (inp.height * 9) / 16 / inp.width, f = tracks[inp.n].at(t), left = Math.max(0, Math.min(1 - cw, (f?.cx ?? 0.5) - cw / 2));
      return { x: ((x - left) / cw) * W, y: y * H };
    }
    if (wideMode(inp)) {
      const cw = (inp.height * WIDE_A) / inp.width, f = tracks[inp.n]?.at(t), left = Math.max(0, Math.min(1 - cw, (f?.cx ?? 0.5) - cw / 2)), wh = W / WIDE_A;
      return { x: ((x - left) / cw) * W, y: (H - wh) / 2 + y * wh };
    }
    const s = Math.min(W / inp.width, H / inp.height), fw = inp.width * s, fh = inp.height * s;
    return { x: (W - fw) / 2 + x * fw, y: (H - fh) / 2 + y * fh };
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const stickerNames = listStickers();
  const all = (Array.isArray(plan.marks) ? plan.marks : []).slice(0, 10).flatMap((m) => {
    if (recipe.minimal && m.type !== "leak") return []; // cinematic: no stickers, arrows, confetti…
    if (!["arrow", "circle", "bar", "sticker", "confetti", "sparkle", "burst", "leak"].includes(m.type)) return [];
    if (m.type === "sticker" && !stickerNames.includes(m.name)) return [];
    const start = mapTime(Math.max(0, +m.t || 0)), end = Math.min(contentEnd, start + Math.max(0.6, +m.d || 2));
    if (start >= contentEnd - 0.3) return [];
    // SAFE ZONE: the countdown bar sits just above the platform caption at the latest
    if (m.type === "bar") return [{ type: "bar", start, end, x: 0, y: clamp((+m.y || 0.75) * H, SAFE.top, SAFE.bottom - 24) }];
    if (m.type === "leak" || m.type === "confetti") return [{ type: m.type, start, end, style: m.style, x: W / 2, y: 0 }];
    const fx = clamp(m.x ?? 0.5, 0, 1), fy = clamp(m.y ?? 0.5, 0, 1);
    let pt = { x: fx * W, y: fy * H }; // no input number → x,y are positions in the final 9:16 frame
    if (byN[m.n]) {
      const p = pieces.find((q) => start >= q.offset && start < q.offset + q.dur) || pieces[pieces.length - 1];
      if (byN[m.n] === p.inp) pt = toFrame(p.inp, p.start + (start - p.offset) * (p.speed || 1), fx, fy);
    }
    const size = clamp((+m.s || 0.24) * W, 90, 300);
    // SAFE ZONE: stickers / sparkles / bursts stay inside it; arrows & circles point at content, but not under the caption
    if (m.type === "sticker") pt = { x: clamp(pt.x, SAFE.left + size / 2, SAFE.right - size / 2), y: clamp(pt.y, SAFE.top + size / 2, SAFE.bottom - size / 2) };
    else if (m.type === "sparkle" || m.type === "burst") pt = { x: clamp(pt.x, SAFE.left, SAFE.right), y: clamp(pt.y, SAFE.top, SAFE.bottom) };
    else pt.y = Math.min(pt.y, SAFE.bottom);
    return [{ type: m.type, start, end, x: pt.x, y: pt.y, name: m.name, r: clamp((+m.r || 0.13) * W, 40, 300), size }];
  });
  // things placed on a shot (stickers, arrows, circles, sparkles) leave when that shot ends
  for (const m of all) {
    if (!["sticker", "arrow", "circle", "sparkle"].includes(m.type)) continue;
    // (during a transition two shots overlap: the one arriving is the one it belongs to)
    const i = pieces.findLastIndex((q) => m.start >= q.offset - 0.05);
    if (i < 0) continue;
    let j = i;
    while (j + 1 < pieces.length && pieces[j + 1].id === pieces[i].id) j++;
    m.end = Math.max(m.start + 0.5, Math.min(m.end, pieces[j].offset + pieces[j].dur));
  }
  const marks = all.filter((m) => !["sticker", "leak"].includes(m.type));
  const stickers = all.filter((m) => m.type === "sticker").map((m) => ({ ...m, file: path.join(STICKER_DIR, `${m.name}.png`) }));
  // brand: logo as a small watermark (top-left, inside the safe zone) + big on the outro card
  if (brand.logo && fs.existsSync(brand.logo)) {
    if (brand.watermark) stickers.push({ file: brand.logo, start: 0, end: contentEnd, x: SAFE.left + 45, y: SAFE.top + 45, size: 80, still: true, opacity: 0.85 });
    if (outro) stickers.push({ file: brand.logo, start: outro.offset + 0.1, end: total, x: W / 2, y: H * 0.36, size: 200 });
  }
  const leaks = [];
  for (const m of all.filter((m) => m.type === "leak").slice(0, 3)) leaks.push({ start: m.start, file: await leakFile(m.style) });

  // sound design (real recordings from assets/sfx/<kind>/; a kind with no files is skipped):
  // whoosh on moving transitions, impact on key sentences + big centre texts, pop when a headline / sticker appears,
  // and before each big reveal: a riser that builds up + the music drops out for a moment (silence makes the hit land)
  await ensureRisers().catch(() => {});
  const lib = sfxLibrary();
  const sfx = [];
  const add = (kind, at, volume) => lib[kind] && !sfx.some((s) => Math.abs(s.at - at) < 0.3) && sfx.push({ file: lib[kind](), at: Math.max(0, at), volume });
  const reveals = recipe.risers
    ? [...pieces.filter((p) => p.emph).map((p) => p.offset), ...texts.filter((t) => t.anim === "highlight" || t.style === "Center").map((t) => t.start), ...all.filter((m) => m.type === "burst").map((m) => m.start)]
        .filter((t) => t > 1.2 && t < contentEnd).sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 1.5).slice(0, 4)
    : [];
  for (const r of reveals) add("riser", r - 1.1, 0.5);
  const SOFT = new Set(["fade", "dip", "blur"]);
  shotStarts.forEach((i, k) => joins[k] && !SOFT.has(joins[k].name) && add("whoosh", pieces[i].offset + joins[k].d / 2 - 0.25, 0.5));
  pieces.forEach((p) => p.emph && !recipe.minimal && add("impact", p.offset, 0.45));
  for (const m of all) if (m.type === "burst") add("impact", m.start, 0.45);
  for (const m of all) if (m.type === "sticker" || m.type === "confetti") add("pop", m.start + 0.05, 0.35);
  // calm recipes (story, talking head) stay quiet: no pop on every text
  for (const t of texts) if (!recipe.minimal && (!recipe.calm || t.style === "Center")) add(t.style === "Center" ? "impact" : "pop", t.start, t.style === "Center" ? 0.45 : 0.3);
  sfx.sort((a, b) => a.at - b.at).splice(18);

  const hasVoice = pieces.some((p) => p.inp.type === "video" && p.inp.hasSpeech);
  const music = track ? { file: track.file, startAt, volume: hasVoice ? (recipe.calm ? 0.25 : 0.35) : 0.75, duck: hasVoice, dips: reveals.map((r) => [r - 0.45, r + 0.05]) } : null;

  // baked-in black bars (letterboxed films, exported clips): found per shot and cropped away
  for (const p of pieces)
    if (p.inp.type === "video" && !framed.has(p.inp.n))
      p.bars = await detectBars(path.join(dir, p.inp.file), p.start + Math.max(0, (p.dur * (p.speed || 1)) / 2 - 0.75), p.inp.width, p.inp.height);

  // 9) render (one at a time)
  setStage("rendering");
  await exclusive(async () => {
    fs.writeFileSync(path.join(dir, "edit.ass"), buildAss({ texts, subs, marks, accent: brand.color, minimal: !!recipe.minimal }));
    await renderReel(
      dir,
      pieces.map((p) => {
        if (p.id === "outro") return { card: "0x0E0E14", dur: p.dur, shot: p.id };
        const barsOf = p.bars;
        const z = p.emph ? 1.2 : p.alt ? 1.1 : 0;
        return {
          file: p.inp.file, start: p.start, dur: p.dur, isImage: p.inp.type === "image", hasAudio: p.inp.hasAudio,
          voice: p.inp.type === "video" && p.inp.hasSpeech, shot: p.id, look, brighten: brighten.has(p.inp.n) && !auto[p.inp.n],
          auto: auto[p.inp.n], framed: framed.has(p.inp.n),
          crop: cropMode(p.inp) ? cropKeys(p.inp, p.start, p.dur, p.fx, p.speed) : null, wide: wideMode(p.inp) ? cropKeys(p.inp, p.start, p.dur, p.fx, p.speed) : null,
          speed: p.speed || 1, bars: barsOf,
          // a clip's own sound (street, crowd, a dog) sits quietly under the music instead of fighting it
          bg: !!track && !(p.inp.type === "video" && p.inp.hasSpeech),
          punch: z && !framed.has(p.inp.n) ? { z, ...faceInFrame(p.inp, p.start + (p.dur * (p.speed || 1)) / 2) } : null,
        };
      }),
      "edit.ass", "out.mp4", { music, sfx, joins, total, stickers, leaks, film: !!recipe.film }
    );
    const cf = byN[plan.coverFrom?.n] || clips[0].inp;
    const ct = cf.type === "image" ? 0 : Math.min(cf.duration - 0.1, Math.max(0, +plan.coverFrom?.s || clips[0].start));
    fs.writeFileSync(path.join(dir, "cover.ass"), buildAss({ texts: plan.cover ? [{ start: 0, end: 10, text: plan.cover, style: "Cover" }] : [], accent: brand.color }));
    await renderCover(dir, {
      file: cf.file, start: ct, isImage: cf.type === "image", look, auto: auto[cf.n], framed: framed.has(cf.n),
      brighten: brighten.has(cf.n) && !auto[cf.n], crop: cropMode(cf) ? cropKeys(cf, ct, 0) : null, wide: wideMode(cf) ? cropKeys(cf, ct, 0) : null,
    }, "cover.ass", "cover.jpg");
  });

  // tidy: keep inputs (for retry / revise), drop scratch files
  for (const f of fs.readdirSync(dir)) if (/^(f\d+-\d+\.jpg|a\d+\.mp3|sheet\d+\.jpg|cell-\d+\.jpg)$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });

  return {
    output: {
      caption: plan.caption || "", hashtags: plan.hashtags || [], hooks: plan.hooks || [], cover: plan.cover || "", tips: plan.tips || [],
      scenes: texts.map((t) => ({ t: `${t.start.toFixed(1)}s`, v: "متن روی ویدیو", x: t.text })),
      subtitles: subs.length > 0, duration: Math.round(total), jumpCuts, recipe: recipe.name,
      music: track ? { mood, bpm: track.bpm, track: path.basename(track.file) } : null,
      look, transitions: joins.filter(Boolean).map((j) => j.name), emphasis: emphasis.length,
      smartCrop: Object.keys(tracks).some((n) => cropMode(byN[n])), colorFixed: Object.values(auto).filter(Boolean).length,
      narration: transcript.length
        ? { language: spokenLang, text: subSource.map((s) => s.text).join(" "), original: transcript.map((s) => s.text).join(" ") }
        : null,
    },
    video: url("out.mp4"),
    coverImg: url("cover.jpg"),
    usage,
    // kept on the job so "revise" can change the plan without new frames / speech-to-text
    plan, transcript: transcript.map(({ n, start, end, text, words }) => ({ n, start, end, text, words })), spokenLang,
  };
}
