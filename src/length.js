// Reel length enforced in code (P1-2): the model's clips are trimmed or extended, deterministically, until they
// add up to the target. The model only asks; this decides.
//
// clip: {inp: {n, type, duration}, start, dur, speed}   (dur = seconds on the OUTPUT timeline = source length / speed)
// lines: {n: [{start, end}]} transcript lines of the inputs that are speech (cuts land on sentence ends, never mid-line)

export const TOLERANCE = 0.1; // ±10 % of the aim is "on target"
const MIN_CLIP = 1.0, MIN_STILL = 1.5, STEP = 2; // shortest clip / photo (s), extension step per clip and round

const srcLen = (c) => c.dur * (c.speed || 1);
const sum = (clips) => clips.reduce((a, c) => a + c.dur, 0);
// the line that `t` falls inside (strictly), if any
const lineAt = (ls, t) => ls.find((l) => t > l.start + 0.01 && t < l.end - 0.01);

/** New end (source seconds) for cutting a clip down to `want`, or null if no clean cut exists. */
function cutEnd(c, want, ls) {
  const end = c.start + want;
  const inside = lineAt(ls, end);
  if (!inside) return end;
  // inside a sentence → back to where it starts (the sentence goes out whole), if that leaves enough
  return inside.start >= c.start + MIN_CLIP * (c.speed || 1) ? inside.start : null;
}

/**
 * New end (source seconds) for growing a clip up to `limit`, or null. Never stops in the middle of a sentence; a
 * sentence that would run past `cap` (the top of the tolerance band) is left out instead of finished.
 */
function growEnd(c, want, limit, cap, ls) {
  const old = c.start + srcLen(c);
  let end = Math.min(limit, old + want);
  const inside = lineAt(ls, end);
  if (inside) end = inside.end <= Math.min(limit, cap) ? inside.end : inside.start;
  return end > old + 0.05 ? end : null;
}

/** Free footage of input n around [a, b]: from the end of the previous used part to the start of the next one. */
function room(clips, self, n, duration) {
  const a = self.start, b = self.start + srcLen(self);
  let before = 0, after = duration;
  for (const c of clips) {
    if (c === self || c.inp.n !== n) continue;
    const ca = c.start, cb = c.start + srcLen(c);
    if (cb <= a + 0.01) before = Math.max(before, cb);
    if (ca >= b - 0.01) after = Math.min(after, ca);
  }
  return { before, after };
}

/**
 * Fit clips to `aim` seconds. Returns {clips, log}. Order of moves:
 *  too long  → shorten the longest clip from its end (a sentence goes whole); if nothing can shrink, drop the last clip
 *  too short → grow the shortest clip into unused footage after it (then before it; never before the first clip:
 *              its start is the hook), photos up to maxStill. Stops when there is no unused footage left.
 */
export function fitLength(input, aim, { lines = {}, maxStill = 8 } = {}) {
  const clips = input.map((c) => ({ ...c }));
  const log = [];
  if (!(aim > 0) || !clips.length) return { clips, log };
  const ls = (c) => (c.inp.type === "video" ? lines[c.inp.n] || [] : []);

  // ---- too long ----
  if (sum(clips) > aim * (1 + TOLERANCE)) {
    const fixed = new Set();
    for (let guard = 0; guard < 200 && sum(clips) > aim + 0.05; guard++) {
      const need = sum(clips) - aim;
      const c = clips.filter((x) => !fixed.has(x)).sort((x, y) => y.dur - x.dur)[0];
      if (!c) {
        if (clips.length <= 1) break;
        const gone = clips.pop();
        log.push(`dropped clip ${gone.inp.n}@${gone.start.toFixed(1)} (${gone.dur.toFixed(1)} s)`);
        fixed.clear();
        continue;
      }
      if (c.inp.type === "image") {
        const d = Math.max(MIN_STILL, c.dur - need);
        if (d >= c.dur - 0.05) { fixed.add(c); continue; }
        log.push(`photo ${c.inp.n} ${c.dur.toFixed(1)}→${d.toFixed(1)} s`);
        c.dur = d;
        continue;
      }
      const sp = c.speed || 1;
      const want = Math.max(MIN_CLIP * sp, srcLen(c) - need * sp);
      const end = want < srcLen(c) - 0.05 ? cutEnd(c, want, ls(c)) : null;
      if (end == null || end >= c.start + srcLen(c) - 0.05) { fixed.add(c); continue; }
      log.push(`clip ${c.inp.n}@${c.start.toFixed(1)} ${c.dur.toFixed(1)}→${((end - c.start) / sp).toFixed(1)} s`);
      c.dur = (end - c.start) / sp;
    }
  }

  // ---- too short ----
  if (sum(clips) < aim * (1 - TOLERANCE)) {
    const fixed = new Set();
    for (let guard = 0; guard < 400 && sum(clips) < aim - 0.05; guard++) {
      const need = aim - sum(clips);
      const c = clips.filter((x) => !fixed.has(x)).sort((x, y) => x.dur - y.dur)[0];
      if (!c) break;
      if (c.inp.type === "image") {
        const d = Math.min(maxStill, c.dur + Math.min(need, STEP));
        if (d <= c.dur + 0.05) { fixed.add(c); continue; }
        log.push(`photo ${c.inp.n} ${c.dur.toFixed(1)}→${d.toFixed(1)} s`);
        c.dur = d;
        continue;
      }
      if (c.inp.type !== "video") { fixed.add(c); continue; }
      const sp = c.speed || 1, step = Math.min(need, STEP) * sp;
      const { before, after } = room(clips, c, c.inp.n, c.inp.duration);
      const cap = c.start + srcLen(c) + (aim * (1 + TOLERANCE) - sum(clips)) * sp;
      const end = growEnd(c, step, after, cap, ls(c));
      if (end != null) {
        log.push(`clip ${c.inp.n}@${c.start.toFixed(1)} +${((end - c.start - srcLen(c)) / sp).toFixed(1)} s after`);
        c.dur = (end - c.start) / sp;
        continue;
      }
      // before the clip (not the first one: its opening frame is the hook)
      if (c !== clips[0] && c.start - before > 0.05) {
        let s = Math.max(before, c.start - step);
        const inside = lineAt(ls(c), s);
        if (inside) s = inside.start >= before && (c.start - inside.start) / sp <= aim * (1 + TOLERANCE) - sum(clips) ? inside.start : inside.end;
        if (s < c.start - 0.05) {
          log.push(`clip ${c.inp.n}@${c.start.toFixed(1)} +${((c.start - s) / sp).toFixed(1)} s before`);
          c.dur += (c.start - s) / sp;
          c.start = s;
          continue;
        }
      }
      fixed.add(c);
    }
  }
  return { clips, log };
}
