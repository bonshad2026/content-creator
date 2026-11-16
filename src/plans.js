// Plans (what a user may make) and the admin role.
// - Plans live in the db (db.plans) and are edited by the admin. A limit of 0 = not allowed, null = unlimited.
// - New users get db.settings.defaultPlan ("none" = nothing until the admin assigns a plan → invite-only beta).
// - A plan can have an end date (user.planUntil); after it the user falls back to the default plan.
// - The admin is the phone number(s) in ADMIN_PHONE (comma-separated). The admin has no limits.
// Counting: jobs the user created in the window, except the ones that failed (a failed reel costs the user nothing).
// "Today" is the calendar day in Iran (Asia/Tehran); "month" is the last 30 days.
import { normalizePhone } from "./auth.js";

export const DEFAULT_PLANS = {
  none: { id: "none", name: "غیرفعال", reelsPerDay: 0, reelsPerMonth: 0, postsPerDay: 0 },
  trial: { id: "trial", name: "آزمایشی", reelsPerDay: 2, reelsPerMonth: 20, postsPerDay: 5 },
  pro: { id: "pro", name: "حرفه‌ای", reelsPerDay: 10, reelsPerMonth: 200, postsPerDay: 30 },
};
export const LIMITS = ["reelsPerDay", "reelsPerMonth", "postsPerDay"];

export function ensurePlans(db) {
  db.plans ??= structuredClone(DEFAULT_PLANS);
  db.settings ??= {};
  if (!db.plans[db.settings.defaultPlan]) db.settings.defaultPlan = "none";
}

const adminPhones = () => String(process.env.ADMIN_PHONE || "").split(",").map((p) => normalizePhone(p)).filter(Boolean);
export const isAdmin = (user) => !!user && adminPhones().includes(user.phone);

/** The plan in force now (an expired or deleted plan → the default plan). */
export function planOf(db, user, now = Date.now()) {
  ensurePlans(db);
  const own = user.plan && db.plans[user.plan] && !(user.planUntil && user.planUntil < now) ? user.plan : db.settings.defaultPlan;
  return db.plans[own] || DEFAULT_PLANS.none;
}

const fa = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
const tehranDay = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });

export function usageOf(db, user, now = Date.now()) {
  const today = tehranDay(now), monthAgo = now - 30 * 86_400_000;
  const mine = db.jobs.filter((j) => j.userId === user.id && j.status !== "error");
  const reels = mine.filter((j) => j.kind === "reel"), posts = mine.filter((j) => j.kind !== "reel");
  return {
    reelsToday: reels.filter((j) => tehranDay(j.createdAt) === today).length,
    reelsMonth: reels.filter((j) => j.createdAt >= monthAgo).length,
    postsToday: posts.filter((j) => tehranDay(j.createdAt) === today).length,
  };
}

/** null if the user may start one more job of this kind ("reel" or "post"), else the reason (Persian, shown to the user). */
export function quotaError(db, user, kind, now = Date.now()) {
  if (isAdmin(user)) return null;
  const plan = planOf(db, user, now), used = usageOf(db, user, now);
  const over = (limit, n) => limit != null && n >= limit;
  if (kind === "reel") {
    if (plan.reelsPerDay === 0 || plan.reelsPerMonth === 0) return "حسابت هنوز برای ساخت ریلز فعال نشده.";
    if (over(plan.reelsPerDay, used.reelsToday)) return `سهم امروزت تموم شد (${fa(plan.reelsPerDay)} ریلز در روز). فردا دوباره امتحان کن.`;
    if (over(plan.reelsPerMonth, used.reelsMonth)) return `سهم این ماهت تموم شد (${fa(plan.reelsPerMonth)} ریلز در ۳۰ روز).`;
  } else {
    if (plan.postsPerDay === 0) return "حسابت هنوز برای ساخت پست فعال نشده.";
    if (over(plan.postsPerDay, used.postsToday)) return `سهم امروزت تموم شد (${fa(plan.postsPerDay)} پست در روز). فردا دوباره امتحان کن.`;
  }
  return null;
}

/** What the app shows the user about their plan. */
export function planView(db, user, now = Date.now()) {
  const plan = planOf(db, user, now);
  return { id: plan.id, name: plan.name, ...Object.fromEntries(LIMITS.map((k) => [k, plan[k] ?? null])), until: user.planUntil || null, used: usageOf(db, user, now) };
}

/** A plan as the admin sent it → clean (id: latin letters/digits/-, limits: whole numbers ≥ 0 or null). */
export function cleanPlan(raw = {}) {
  const id = String(raw.id || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{2,20}$/.test(id)) throw Object.assign(new Error("شناسه‌ی پلن: ۲ تا ۲۰ حرف انگلیسی، عدد یا -"), { status: 400 });
  const name = String(raw.name || "").trim().slice(0, 30);
  if (!name) throw Object.assign(new Error("اسم پلن را وارد کنید."), { status: 400 });
  const limit = (v) => (v === null || v === "" || v === undefined ? null : Math.max(0, Math.floor(Number(v)) || 0));
  return { id, name, ...Object.fromEntries(LIMITS.map((k) => [k, limit(raw[k])])) };
}
