// The edit plan: ONE schema (zod) for every source — the model (planReel), a revise (revisePlan), hand-written test
// plans and the demo mock. A sloppy plan is repaired, not rejected: each field and each list item is checked on its
// own, a bad one is fixed when the intent is clear (a number written as text, in/out swapped, a missing "#") or
// dropped, and every repair / drop is reported with its reason. A cheaper model's slips cost a little, never the reel.
import { z } from "zod";

const num = z.coerce.number().refine(Number.isFinite, "not a number");
const pos = num.pipe(z.number().min(0));
const unit = num.pipe(z.number().min(0).max(1)); // 0-1 position in a frame
const int = num.pipe(z.number().int().min(1));
const text = (max) => z.string().trim().min(1).max(max);
const strList = (max, itemMax) => z.array(z.unknown()).max(200).transform((a) => a.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, itemMax)).slice(0, max));

export const ClipSchema = z
  .object({ n: int, s: pos.default(0), e: pos, speed: num.pipe(z.number().min(0.3).max(3)).optional(), x: unit.optional() })
  // in / out swapped → swapped back (the intent is clear); equal → nothing to show
  .transform((c) => (c.e < c.s ? { ...c, s: c.e, e: c.s } : c))
  .refine((c) => c.e - c.s >= 0.1, "clip shorter than 0.1 s");

export const TextSchema = z.object({
  t: pos.default(0),
  d: num.pipe(z.number().min(0.3).max(20)).default(2),
  text: text(120),
  pos: z.enum(["top", "center", "bottom"]).catch("top"),
  anim: z.string().optional(),
});

const at = { t: pos.default(0), d: num.pipe(z.number().min(0.2).max(20)).optional() };
const spot = { x: unit, y: unit, n: int.optional() };
export const MarkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("arrow"), ...at, ...spot }),
  z.object({ type: z.literal("circle"), ...at, ...spot, r: unit.optional() }),
  z.object({ type: z.literal("bar"), ...at, y: unit.optional() }),
  z.object({ type: z.literal("sticker"), ...at, ...spot, name: z.string().min(1), s: num.pipe(z.number().min(0.05).max(0.6)).optional() }),
  z.object({ type: z.literal("sparkle"), ...at, ...spot }),
  z.object({ type: z.literal("burst"), ...at, ...spot }),
  z.object({ type: z.literal("confetti"), ...at }),
  z.object({ type: z.literal("leak"), ...at, style: z.string().optional() }),
]);

// top-level fields that are not lists of objects
const FIELDS = {
  recipe: z.string().trim().min(1),
  framed: z.array(z.unknown()).transform((a) => [...new Set(a.map(Number).filter((n) => Number.isInteger(n) && n >= 1))]),
  brighten: z.array(z.unknown()).transform((a) => [...new Set(a.map(Number).filter((n) => Number.isInteger(n) && n >= 1))]),
  subtitles: z.union([z.boolean(), z.enum(["true", "false"]).transform((s) => s === "true")]),
  subs: z.array(z.unknown()).transform((a) => a.map((x) => (typeof x === "string" ? x.trim() : ""))),
  music: z.string().trim().min(1),
  look: z.string().trim().min(1),
  transitions: z.array(z.unknown()).transform((a) => a.map((x) => (typeof x === "string" ? x : ""))),
  emphasis: z.array(z.unknown()).transform((a) => a.map(Number).filter((i) => Number.isInteger(i) && i >= 0).slice(0, 3)),
  coverFrom: z.object({ n: int, s: pos.optional() }),
  cover: z.string().trim().max(60),
  cta: z.string().trim().max(40),
  hooks: strList(5, 120),
  caption: z.string().trim().max(2200),
  hashtags: strList(30, 60).transform((a) => a.map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, "_"))),
  tips: strList(4, 200),
};
const LISTS = { clips: [ClipSchema, 40], texts: [TextSchema, 20], marks: [MarkSchema, 10] };

const why = (err) => err.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ");
const short = (v) => {
  const s = JSON.stringify(v);
  return s && s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

/**
 * raw plan (any shape) → {plan, issues}. ctx (optional) checks against the real job:
 *   inputs: [{n, type}] · recipes · looks · moods · stickers · transitions · anims (name lists)
 * issues: ["texts[3] dropped: text: String must contain at least 1 character(s)", "look \"teal\" unknown → dropped", …]
 */
export function normalizePlan(raw, ctx = {}) {
  const issues = [];
  const plan = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { plan: { clips: [] }, issues: ["plan is not an object"] };

  for (const [key, [schema, max]] of Object.entries(LISTS)) {
    if (raw[key] == null) continue;
    if (!Array.isArray(raw[key])) { issues.push(`${key} is not a list → dropped`); continue; }
    const out = [];
    raw[key].forEach((item, i) => {
      const r = schema.safeParse(item);
      if (r.success) out.push(r.data);
      else issues.push(`${key}[${i}] ${short(item)} dropped: ${why(r.error)}`);
    });
    if (out.length > max) issues.push(`${key}: ${out.length - max} over the limit of ${max} dropped`);
    plan[key] = out.slice(0, max);
  }
  for (const [key, schema] of Object.entries(FIELDS)) {
    if (raw[key] == null) continue;
    const r = schema.safeParse(raw[key]);
    if (r.success) plan[key] = r.data;
    else issues.push(`${key} ${short(raw[key])} dropped: ${why(r.error)}`);
  }
  const unknown = Object.keys(raw).filter((k) => !(k in FIELDS) && !(k in LISTS));
  if (unknown.length) issues.push(`unknown fields ignored: ${unknown.join(", ")}`);

  // ---- against the job (names and input numbers the model cannot know for sure) ----
  const inputs = ctx.inputs ? new Map(ctx.inputs.map((i) => [i.n, i])) : null;
  if (inputs) {
    const keep = (key, ok, what) => {
      if (!plan[key]) return;
      plan[key] = plan[key].filter((x, i) => ok(x) || (issues.push(`${key}[${i}] ${what(x)} → dropped`), false));
    };
    keep("clips", (c) => inputs.has(c.n), (c) => `input ${c.n} does not exist`);
    keep("marks", (m) => m.n == null || inputs.has(m.n), (m) => `input ${m.n} does not exist`);
    if (plan.framed) plan.framed = plan.framed.filter((n) => inputs.has(n) || (issues.push(`framed: input ${n} does not exist → dropped`), false));
    if (plan.coverFrom && !inputs.has(plan.coverFrom.n)) { issues.push(`coverFrom: input ${plan.coverFrom.n} does not exist → dropped`); delete plan.coverFrom; }
    // a clip past the end of its video starts at most 0.5 s before the end; its end is clamped
    for (const c of plan.clips || []) {
      const inp = inputs.get(c.n);
      if (inp.type === "video" && inp.duration && c.e > inp.duration + 0.05) {
        issues.push(`clip ${c.n} ${c.s}-${c.e} ends after the video (${inp.duration.toFixed(1)} s) → clamped`);
        c.e = inp.duration;
        if (c.s > inp.duration - 0.5) c.s = Math.max(0, inp.duration - 0.5);
      }
    }
  }
  const named = (key, list, label) => {
    if (!list || plan[key] == null || list.includes(plan[key]) || plan[key] === "none") return;
    issues.push(`${label} "${plan[key]}" unknown → dropped`);
    delete plan[key];
  };
  named("recipe", ctx.recipes, "recipe");
  named("look", ctx.looks, "look");
  named("music", ctx.moods, "music mood");
  if (ctx.stickers && plan.marks)
    plan.marks = plan.marks.filter((m, i) => m.type !== "sticker" || ctx.stickers.includes(m.name) || (issues.push(`marks[${i}] sticker "${m.name}" unknown → dropped`), false));
  if (ctx.anims && plan.texts)
    for (const [i, t] of plan.texts.entries()) if (t.anim && !ctx.anims.includes(t.anim)) { issues.push(`texts[${i}] anim "${t.anim}" unknown → recipe's choice`); delete t.anim; }
  if (ctx.transitions && plan.transitions)
    plan.transitions = plan.transitions.map((t, i) => (ctx.transitions.includes(t) ? t : (t && issues.push(`transitions[${i}] "${t}" unknown → recipe's choice`), "")));
  return { plan, issues };
}
