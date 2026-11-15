// Moments (P1-5) unit tests: cutting, scoring, coverage and the moment-plan → normal-plan conversion. 0 tokens.
// Usage: npm run test:moments
import { cutMoments, scoreMoments, pickMoments, momentsToPlan } from "../src/moments.js";
import { normalizePlan } from "../src/plan.js";

const results = [];
const check = (name, ok, note = "") => results.push({ case: name, ok: ok ? "PASS" : "FAIL", note: String(note).slice(0, 100) });

// ---- cutting ----
{
  const v = { n: 1, type: "video", duration: 30 };
  const lines = [{ start: 0.5, end: 2 }, { start: 2.1, end: 4.5 }, { start: 5, end: 13 }, { start: 13.2, end: 15 }];
  const ms = cutMoments(v, { lines });
  check("speech: no sentence is split", lines.every((l) => ms.some((m) => m.s <= l.start && m.e >= l.end)), JSON.stringify(ms.map((m) => [m.s, m.e])));
  check("speech: short lines grouped, long line alone", ms.length === 3, ms.length);
  check("speech: moments never overlap", ms.every((m, i) => !i || m.s >= ms[i - 1].e - 1e-9), JSON.stringify(ms.map((m) => [m.s, m.e])));
  const shots = cutMoments(v, { cuts: [3, 3.6, 4.1, 20] });
  check("shots: never span a shot change (after merging slivers)", shots.every((m) => ![20].some((c) => c > m.s + 0.01 && c < m.e - 0.01)));
  check("shots: no sliver under 1.2 s", shots.every((m) => m.e - m.s >= 1.2), JSON.stringify(shots.map((m) => [m.s, +m.e.toFixed(1)])));
  check("shots: long shot split, none over 6 s", shots.every((m) => m.e - m.s <= 6.01));
}
// ---- scoring: the busy, loud part ranks above the still, quiet part ----
{
  const ms = [{ s: 0, e: 4, kind: "shot" }, { s: 4, e: 8, kind: "shot" }];
  const act = { motion: [[1, 1], [2, 1], [5, 20], [6, 25]], loud: [[1, -40], [5, -15]] };
  const [a, b] = scoreMoments(ms, act);
  check("motion + loudness raise the score", b.score > a.score, `${a.score} vs ${b.score}`);
}
// ---- coverage: a video that gets louder towards the end still offers moments from all of it ----
{
  const v = { n: 1, type: "video", duration: 300 };
  const cuts = Array.from({ length: 74 }, (_, i) => (i + 1) * 4);
  const act = { motion: Array.from({ length: 600 }, (_, i) => [i / 2, i / 30]), loud: [] }; // rises steadily
  const ms = pickMoments([v], { 1: { cuts, act } }, 3, 20);
  const firstHalf = ms.filter((m) => m.s < 150).length;
  check("coverage: at least a third from the first half", firstHalf >= ms.length / 3, `${firstHalf} of ${ms.length}`);
  check("numbered 1..N in time order", ms.every((m, i) => m.id === i + 1 && (!i || m.s >= ms[i - 1].s)));
}
// ---- conversion ----
{
  const moments = [
    { id: 1, n: 1, s: 0, e: 4, kind: "shot" }, { id: 2, n: 1, s: 10, e: 13, kind: "speech" },
    { id: 3, n: 1, s: 20, e: 24, kind: "shot" }, { id: 4, n: 2, s: 0, e: 3, kind: "photo" },
  ];
  const { plan, issues } = momentsToPlan({
    moments: [3, 1, "2", 9, 3], slow: [3, 2], texts: [{ m: 3, text: "هوک", pos: "top" }, { m: 2, text: "دوم" }, { m: 4, text: "انتخاب نشده" }],
    marks: [{ m: 1, type: "confetti" }], coverFrom: { m: 4 }, cover: "کاور",
  }, moments);
  check("clips in the picked order", JSON.stringify(plan.clips.map((c) => c.s)) === "[20,0,10]", JSON.stringify(plan.clips));
  check("slow motion only on a shot, not on speech", plan.clips[0].speed === 0.6 && !plan.clips[2].speed);
  check("text lands on its moment's output time", plan.texts[0].t === 0.2 && Math.abs(plan.texts[1].t - (4 / 0.6 + 4 + 0.2)) < 0.01, JSON.stringify(plan.texts.map((t) => t.t)));
  check("text on an unpicked moment dropped", plan.texts.length === 2);
  check("unknown and repeated moments reported", issues.some((i) => i.includes("9")) && issues.some((i) => i.includes("twice")), issues.join(" | "));
  check("cover from a moment (even unpicked)", plan.coverFrom.n === 2);
  check("mark placed on its moment", Math.abs(plan.marks[0].t - (4 / 0.6 + 0.2)) < 0.01, plan.marks[0].t);
  const n = normalizePlan(plan, { inputs: [{ n: 1, type: "video", duration: 30 }, { n: 2, type: "image" }] });
  check("result passes the plan schema untouched", n.issues.length === 0, n.issues.join(" | "));
}
// ---- templates: quiz / list / before-after / ending / short marks ----
{
  const ms = [1, 2, 3, 4, 5].map((id) => ({ id, n: 1, s: (id - 1) * 4, e: id * 4, kind: "shot" }));
  const { plan, issues } = momentsToPlan({
    moments: [1, 2, 3, 4], quiz: [{ q: 1, ask: "کیه؟", a: 2, answer: "زیدان" }, { q: 3, ask: "این؟", a: 3, answer: "مسی" }, { q: 4, ask: "آخری؟" }, { q: 2, ask: "عقب", a: 1, answer: "x" }],
    ending: "کامنت کن", marks: [{ m: 2, type: "sticker", name: "fire" }],
  }, ms);
  const tx = (s) => plan.texts.find((t) => t.text === s);
  const bars = plan.marks.filter((m) => m.type === "bar");
  check("quiz: question on its moment, answer revealed on the answer moment", tx("کیه؟").t === 0.2 && tx("زیدان").t === 4.2 && tx("زیدان").anim === "highlight", JSON.stringify(plan.texts));
  check("quiz: timer runs from the question to the reveal", Math.abs(bars[0].t - 0.6) < 0.01 && Math.abs(bars[0].t + bars[0].d - 4.1) < 0.01, JSON.stringify(bars));
  check("quiz: a = q reveals in the second half of the moment", tx("مسی").t > 8 + 2 && tx("مسی").t < 12, tx("مسی").t);
  check("quiz: ✅ + sparkle on each reveal, 🤔 at the end", plan.marks.filter((m) => m.name === "check").length === 2 && plan.marks.some((m) => m.type === "sparkle") && plan.marks.some((m) => m.name === "think"));
  check("quiz: open question (and a dropped answer) gets a timer, no answer", bars.length === 4 && !plan.texts.some((t) => t.text === "x"), bars.length);
  check("quiz: answer before its question → dropped + reported", issues.some((i) => i.includes("before its question")), issues.join(" | "));
  check("ending: centre line in the last seconds of the last moment", tx("کامنت کن").pos === "center" && tx("کامنت کن").t >= 12 && tx("کامنت کن").t + tx("کامنت کن").d <= 16.01, JSON.stringify(tx("کامنت کن")));
  const st = plan.marks.find((m) => m.name === "fire");
  check("short sticker gets a spot, size and its moment's length", st.x === 0.78 && st.y === 0.32 && st.s === 0.24 && st.d >= 3, JSON.stringify(st));
  check("template fields removed from the plan", !("quiz" in plan) && !("ending" in plan));
  const n = normalizePlan(plan, { inputs: [{ n: 1, type: "video", duration: 30 }] });
  check("quiz plan passes the schema untouched", n.issues.length === 0, n.issues.join(" | "));

  const l = momentsToPlan({ moments: [2, 1, 5], list: [{ m: 2, text: "اول" }, { m: 1, text: "دوم" }, { m: 4, text: "نیست" }], before: { m: 2, text: "قبل" }, after: { m: 5, text: "بعد" } }, ms);
  check("list: numbered in order, Persian digits", l.plan.texts[0].text === "۱. اول" && l.plan.texts[1].text === "۲. دوم", JSON.stringify(l.plan.texts.map((t) => t.text)));
  check("list point on an unpicked moment reported", l.issues.some((i) => i.includes("list point")), l.issues.join(" | "));
  check("before-after: after revealed with sparkle + burst", l.plan.texts.find((t) => t.text === "بعد").anim === "highlight" && l.plan.marks.some((m) => m.type === "burst"));
}
// ---- the real moments plans saved from the comparison still convert cleanly (no template fields: unchanged behaviour) ----
{
  const fs = await import("node:fs");
  for (const f of ["mixed--opus-moments", "mixed--haiku-moments"]) {
    const saved = JSON.parse(fs.readFileSync(`scripts/fixtures/real-plans/${f}.json`, "utf8"));
    check(`${f}: still has no quiz structure (needs a new real run)`, !saved.raw.quiz && !(saved.raw.marks || []).length);
  }
}

console.table(results);
process.exit(results.every((r) => r.ok === "PASS") ? 0 : 1);
