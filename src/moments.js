// Candidate moments (P1-5): the footage is cut into numbered moments and scored HERE, locally and for free, so the
// model only has to choose among good ones by number ("M3, M7, M12") instead of inventing seconds.
// A moment never splits a sentence (speech) and never spans a shot change (other footage).
import { ffmpegScan } from "./media.js";

const MAX_LEN = 6, MIN_LEN = 1.2, TARGET = 4; // seconds: a moment is one shot / one or two sentences
export const MAX_MOMENTS = 24; // whole reel; long inputs get more of them (by duration)

/** Per-0.5 s motion (mean frame difference, 0-255) and loudness (RMS dB) of a video, one ffmpeg pass each. */
export async function activity(file, maxSec = 600) {
  const [vlog, alog] = await Promise.all([
    ffmpegScan(["-t", String(maxSec), "-i", file, "-an", "-vf", "fps=4,scale=160:-2,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YDIF", "-f", "null", "-"], /pts_time|YDIF/),
    ffmpegScan(["-t", String(maxSec), "-i", file, "-vn", "-af", "aresample=8000,asetnsamples=4000,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,ametadata=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"], /pts_time|RMS_level/),
  ]);
  const series = (log, key) => {
    const out = [];
    let t = null;
    for (const l of log.split("\n")) {
      const m = l.match(/pts_time:([\d.]+)/);
      if (m) t = +m[1];
      const v = l.match(new RegExp(`${key}=(-?[\\d.]+|-inf)`));
      if (v && t != null) out.push([t, v[1] === "-inf" ? -90 : +v[1]]);
    }
    return out;
  };
  return { motion: series(vlog, "YDIF"), loud: series(alog, "RMS_level") };
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const within = (s, a, b) => s.filter(([t]) => t >= a && t < b).map(([, v]) => v);
// rank of v among all values, 0-1 (robust to scale: a calm video's busiest moment still ranks high)
const rankOf = (all, v) => (all.length > 1 ? all.filter((x) => x < v).length / (all.length - 1) : 0.5);

/** Split [a, b] into pieces of about TARGET s, at the given preferred points (pauses) when possible. */
function split(a, b, prefer = []) {
  const out = [];
  let s = a;
  while (b - s > MAX_LEN) {
    const want = s + TARGET;
    const p = prefer.filter((x) => x > s + MIN_LEN && x < s + MAX_LEN).sort((x, y) => Math.abs(x - want) - Math.abs(y - want))[0];
    const e = p ?? Math.min(b, s + TARGET);
    out.push([s, e]);
    s = e;
  }
  if (b - s >= MIN_LEN || !out.length) out.push([s, b]);
  else out[out.length - 1][1] = b; // a tiny leftover joins the previous piece
  return out;
}

/**
 * Raw moments of one video: {s, e, kind}. Speech → whole sentences grouped up to MAX_LEN (a long sentence is one
 * moment on its own); other footage → shots, long shots split at quiet points.
 */
export function cutMoments(v, { lines = [], cuts = [], silences = [] } = {}) {
  const dur = v.duration;
  if (lines.length) {
    const out = [];
    let cur = null;
    for (const l of [...lines].sort((x, y) => x.start - y.start)) {
      if (cur && l.end - cur.s <= MAX_LEN) cur.e = l.end;
      else {
        if (cur) out.push(cur);
        cur = { s: Math.max(0, l.start - 0.15), e: l.end, kind: "speech" };
      }
    }
    if (cur) out.push(cur);
    // a little air around the words, never into the next moment
    return out.map((m, i) => ({ ...m, s: i ? Math.max(m.s, out[i - 1].e) : m.s, e: Math.min(dur, m.e + 0.15, out[i + 1] ? out[i + 1].s : Infinity) }));
  }
  const b = [0, ...cuts.filter((t) => t > 0.3 && t < dur - 0.3), dur];
  // rapid cuts: shots shorter than MIN_LEN join the next one (a quick montage is one moment), up to MAX_LEN
  const shots = [];
  for (let i = 1; i < b.length; i++) {
    const last = shots[shots.length - 1];
    if (last && (last[1] - last[0] < MIN_LEN || b[i] - b[i - 1] < MIN_LEN) && b[i] - last[0] <= MAX_LEN) last[1] = b[i];
    else shots.push([b[i - 1], b[i]]);
  }
  const pauses = silences.map(([a, c]) => (a + Math.min(c, dur)) / 2);
  return shots.flatMap(([a, e]) => split(a, e, pauses).map(([s, e2]) => ({ s, e: e2, kind: "shot" })));
}

/**
 * Score moments of one video 0-1: motion and loudness (ranked within the video), + a little for a shot change
 * inside (energy), + for speech (the words carry the reel). Short slivers lose a little.
 */
export function scoreMoments(moments, act) {
  const m = act.motion.map(([, v]) => v), l = act.loud.map(([, v]) => v);
  const per = moments.map((x) => ({ mo: mean(within(act.motion, x.s, x.e)), lo: Math.max(-90, ...within(act.loud, x.s, x.e), -90) }));
  const allMo = per.map((p) => p.mo), allLo = per.map((p) => p.lo);
  return moments.map((x, i) => {
    const motion = m.length ? rankOf(allMo, per[i].mo) : 0.5, loud = l.length ? rankOf(allLo, per[i].lo) : 0.5;
    const len = x.e - x.s;
    const score = 0.55 * motion + 0.3 * loud + (x.kind === "speech" ? 0.3 : 0) - (len < 1.5 ? 0.1 : 0);
    return { ...x, score: +Math.max(0, Math.min(1.3, score)).toFixed(3), motion: +per[i].mo.toFixed(1) };
  });
}

/**
 * All inputs → numbered moments, best kept: [{id, n, s, e, kind, score}] sorted by input then time, ids 1..N.
 * Photos are one moment each. `perVideo` = {n: {lines, cuts, silences, act}}.
 */
export function pickMoments(inputs, perVideo, imageSec = 3, max = MAX_MOMENTS) {
  const videos = inputs.filter((i) => i.type === "video");
  const photos = inputs.filter((i) => i.type === "image");
  const room = Math.max(videos.length * 3, max - photos.length);
  const total = videos.reduce((a, v) => a + v.duration, 0) || 1;
  const chosen = [];
  for (const v of videos) {
    const ctx = perVideo[v.n] || {};
    const all = scoreMoments(cutMoments(v, ctx), ctx.act || { motion: [], loud: [] });
    const keep = Math.min(all.length, Math.max(3, Math.round((room * v.duration) / total)));
    // coverage first: the best moment of each equal time slice (a fight that gets louder towards the end must not
    // fill the whole list — Arcane run 1 used clips only from the end), then the rest by score
    const slices = Math.max(1, Math.round(keep * 0.75)), got = new Set();
    for (let k = 0; k < slices; k++) {
      const a = (k * v.duration) / slices, z = ((k + 1) * v.duration) / slices;
      const best = all.filter((m) => (m.s + m.e) / 2 >= a && (m.s + m.e) / 2 < z).sort((x, y) => y.score - x.score)[0];
      if (best) got.add(best);
    }
    for (const m of [...all].sort((x, y) => y.score - x.score)) if (got.size < keep) got.add(m);
    // back into time order (the model reads the video as a story)
    chosen.push(...[...got].sort((a, b) => a.s - b.s).map((m) => ({ n: v.n, ...m })));
  }
  for (const p of photos) chosen.push({ n: p.n, s: 0, e: imageSec, kind: "photo", score: 0.5 });
  const order = new Map(inputs.map((i, k) => [i.n, k]));
  return chosen.sort((a, b) => order.get(a.n) - order.get(b.n) || a.s - b.s).map((m, i) => ({ id: i + 1, ...m }));
}

/**
 * A moment-picking plan → the normal plan (clips / texts / marks / coverFrom in seconds), so everything after it
 * (schema, length, render) stays one path. Pure; unknown moment numbers are dropped and reported.
 *   moments: [3, 7, 12]  (play order)        slow: [7]  (slow motion, never on speech)
 *   texts:   [{m: 3, text, pos}]  (shown while that moment plays; m 0 / missing = the opening)
 *   marks:   [{m: 7, type, …}]    coverFrom: {m: 7}
 */
export function momentsToPlan(plan, moments) {
  const byId = new Map(moments.map((m) => [m.id, m]));
  const issues = [];
  const picks = [];
  for (const raw of Array.isArray(plan.moments) ? plan.moments : []) {
    const id = Number(typeof raw === "object" && raw ? raw.m : raw);
    const m = byId.get(id);
    if (!m) { issues.push(`moment ${JSON.stringify(raw)} does not exist → dropped`); continue; }
    if (picks.includes(m)) { issues.push(`moment M${id} picked twice → once`); continue; }
    picks.push(m);
  }
  const slow = new Set((Array.isArray(plan.slow) ? plan.slow : []).map(Number));
  const clips = picks.map((m) => ({ n: m.n, s: +m.s.toFixed(2), e: +m.e.toFixed(2), ...(slow.has(m.id) && m.kind === "shot" ? { speed: 0.6 } : {}) }));
  // where each picked moment starts on the planned output timeline
  const at = new Map();
  let t = 0;
  picks.forEach((m, i) => (at.set(m.id, t), (t += (m.e - m.s) / (clips[i].speed || 1))));
  const place = (x, d) => {
    const id = Number(x.m);
    if (!id) return { t: 0 };
    if (!at.has(id)) return null;
    return { t: +(at.get(id) + 0.2).toFixed(2), ...(d ? { d } : {}) };
  };
  const texts = [];
  for (const x of Array.isArray(plan.texts) ? plan.texts : []) {
    if (x && "t" in x && !("m" in x)) { texts.push(x); continue; } // already in seconds (old format)
    const p = place(x || {});
    if (!p) { issues.push(`text on M${x.m} (not picked) → dropped`); continue; }
    const len = x.m && at.has(Number(x.m)) ? byId.get(Number(x.m)).e - byId.get(Number(x.m)).s : 2.5;
    const { m, ...rest } = x;
    texts.push({ ...rest, ...p, d: +Math.max(1.5, Math.min(3.5, len - 0.3)).toFixed(2) });
  }
  const marks = [];
  for (const x of Array.isArray(plan.marks) ? plan.marks : []) {
    if (x && "t" in x && !("m" in x)) { marks.push(x); continue; }
    const p = place(x || {});
    if (!p) { issues.push(`mark on M${x?.m} (not picked) → dropped`); continue; }
    const { m, ...rest } = x;
    marks.push({ ...rest, ...p });
  }
  const out = { ...plan, clips, texts, marks };
  delete out.moments;
  delete out.slow;
  const cm = byId.get(Number(plan.coverFrom?.m));
  if (cm) out.coverFrom = { n: cm.n, s: +((cm.s + cm.e) / 2).toFixed(2) };
  else if (plan.coverFrom?.m != null) { issues.push(`cover moment M${plan.coverFrom.m} does not exist → first clip`); delete out.coverFrom; }
  return { plan: out, issues };
}
