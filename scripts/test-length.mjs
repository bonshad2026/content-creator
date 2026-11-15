// fitLength unit tests (fast, 0 tokens, no render). Usage: npm run test:length
import { fitLength } from "../src/length.js";

const results = [];
const check = (name, ok, note = "") => results.push({ case: name, ok: ok ? "PASS" : "FAIL", note });
const total = (cs) => cs.reduce((a, c) => a + c.dur, 0);
const vid = (n, duration) => ({ n, type: "video", duration });
const img = (n) => ({ n, type: "image", duration: 3 });
const near = (cs, aim) => Math.abs(total(cs) - aim) <= aim * 0.1;

// too long, no speech: the longest clip is cut first, the order and the first clip's start stay
{
  const v = vid(1, 300);
  const { clips } = fitLength([{ inp: v, start: 0, dur: 10 }, { inp: v, start: 50, dur: 40 }, { inp: v, start: 120, dur: 20 }], 30);
  check("trim to 30", near(clips, 30), total(clips).toFixed(1));
  check("trim keeps first start (hook)", clips[0].start === 0 && clips.length === 3);
}
// too long with speech: cuts land between sentences, never inside one
{
  const v = vid(1, 48);
  const lines = { 1: [{ start: 0, end: 6 }, { start: 6, end: 13 }, { start: 13, end: 21 }, { start: 21, end: 30 }, { start: 30, end: 40 }] };
  const { clips } = fitLength([{ inp: v, start: 0, dur: 40 }], 25, { lines });
  const end = clips[0].start + clips[0].dur;
  check("speech trim ends on a sentence edge", lines[1].some((l) => Math.abs(l.end - end) < 0.01 || Math.abs(l.start - end) < 0.01), `ends at ${end}`);
  check("speech trim near 25", near(clips, 25) || total(clips) <= 25, total(clips).toFixed(1));
}
// too short: grows into unused footage, never into footage another clip already uses
{
  const v = vid(1, 39);
  const { clips } = fitLength([{ inp: v, start: 0, dur: 3 }, { inp: v, start: 10, dur: 3 }, { inp: img(2), start: 0, dur: 2 }], 30, { maxStill: 4 });
  check("extend to 30", near(clips, 30), total(clips).toFixed(1));
  const [a, b] = clips;
  check("no overlap after extending", a.start + a.dur <= b.start + 0.01, `${a.start}+${a.dur.toFixed(1)} vs ${b.start.toFixed(1)}`);
  check("photo capped at maxStill", clips[2].dur <= 4);
}
// not enough material: grows as far as it can and stops
{
  const { clips } = fitLength([{ inp: vid(1, 8), start: 2, dur: 3 }], 30);
  check("short material uses all of it", Math.abs(total(clips) - 6) < 0.01, total(clips).toFixed(1));
}
// slow motion clip: output length counts (e-s)/speed
{
  const { clips } = fitLength([{ inp: vid(1, 100), start: 0, dur: 20, speed: 0.5 }], 10);
  check("speed-aware trim", near(clips, 10) && clips[0].speed === 0.5, total(clips).toFixed(1));
}
// way too many clips: when nothing can shrink further, the last clips are dropped, the first stays
{
  const v = vid(1, 300);
  const cs = Array.from({ length: 20 }, (_, i) => ({ inp: v, start: i * 10, dur: 1 }));
  const { clips } = fitLength(cs, 8);
  check("drops last clips", near(clips, 8) && clips[0].start === 0, `${clips.length} clips, ${total(clips).toFixed(1)} s`);
}
// within ±10 % → untouched
{
  const cs = [{ inp: vid(1, 60), start: 0, dur: 28 }];
  check("inside tolerance untouched", fitLength(cs, 30).log.length === 0);
}

console.table(results);
process.exit(results.every((r) => r.ok === "PASS") ? 0 : 1);
