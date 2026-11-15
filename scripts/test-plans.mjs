// Plans + admin (offline, 0 tokens). Uses its own data folder: never reads or writes the real data/db.json.
// Usage: npm run test:plans
process.env.DATA_DIR = "data/test-out/plans-db";
process.env.ADMIN_PHONE = "0912 000 0000, +989120000001";
const { ensurePlans, isAdmin, planOf, quotaError, usageOf, cleanPlan, planView } = await import("../src/plans.js");

const results = [];
const check = (name, ok, note = "") => results.push({ case: name, ok: ok ? "PASS" : "FAIL", note: String(note).slice(0, 90) });

const DAY = 86_400_000;
// 2026-11-15 12:00 Tehran = 08:30 UTC
const now = Date.parse("2026-11-15T08:30:00Z");
const db = { users: {}, sessions: {}, jobs: [] };
ensurePlans(db);
const u = (id, phone, extra = {}) => (db.users[id] = { id, phone, usage: { tokens: 0 }, ...extra });
const job = (userId, kind, at, status = "done") => db.jobs.push({ id: `${userId}-${db.jobs.length}`, userId, kind, createdAt: at, status });

check("default plans and default = none", db.plans.none && db.plans.trial && db.settings.defaultPlan === "none");
const newbie = u("a", "09121111111");
check("new user: no plan → blocked from reels and posts", quotaError(db, newbie, "reel", now) && quotaError(db, newbie, "post", now));

const admin = u("b", "09120000000");
check("admin by ADMIN_PHONE (spaces, +98 form)", isAdmin(admin) && isAdmin({ phone: "09120000001" }) && !isAdmin(newbie));
check("admin has no limits even on plan none", quotaError(db, admin, "reel", now) === null);

const t = u("c", "09122222222", { plan: "trial" });
job("c", "reel", now - 3600_000);
check("trial: 1 of 2 today → allowed", quotaError(db, t, "reel", now) === null);
job("c", "reel", now - 1800_000);
check("trial: 2 of 2 today → blocked with the day message", /امروز/.test(quotaError(db, t, "reel", now) || ""), quotaError(db, t, "reel", now));
job("c", "reel", now - 600_000, "error");
check("failed jobs do not count", usageOf(db, t, now).reelsToday === 2);
check("posts counted apart from reels", quotaError(db, t, "post", now) === null);

// Tehran day boundary: 23:50 Tehran yesterday (20:20 UTC) is yesterday, 00:10 Tehran today (20:40 UTC) is today
const d = u("d", "09123333333", { plan: "trial" });
job("d", "reel", Date.parse("2026-11-14T20:20:00Z"));
job("d", "reel", Date.parse("2026-11-14T20:40:00Z"));
check("day = calendar day in Tehran", usageOf(db, d, now).reelsToday === 1, JSON.stringify(usageOf(db, d, now)));

// month: 30-day window
const m = u("e", "09124444444", { plan: "trial" });
for (let i = 1; i <= 20; i++) job("e", "reel", now - i * DAY);
check("20 reels in the last 30 days → month limit", /ماه/.test(quotaError(db, m, "reel", now) || ""), quotaError(db, m, "reel", now));
job("e", "reel", now - 31 * DAY);
check("older than 30 days not counted", usageOf(db, m, now).reelsMonth === 20);

// expiry → default plan
const x = u("f", "09125555555", { plan: "pro", planUntil: now - 1000 });
check("expired plan → default plan", planOf(db, x, now).id === "none" && quotaError(db, x, "reel", now));
x.planUntil = now + DAY;
check("plan before its end date → in force", planOf(db, x, now).id === "pro" && planView(db, x, now).until === now + DAY);

// deleted plan → default; unlimited (null)
db.plans.vip = cleanPlan({ id: "vip", name: "VIP", reelsPerDay: "", reelsPerMonth: null, postsPerDay: 3 });
const v = u("g", "09126666666", { plan: "vip" });
for (let i = 0; i < 50; i++) job("g", "reel", now - i * 60_000);
check("null limit = unlimited", quotaError(db, v, "reel", now) === null);
delete db.plans.vip;
check("deleted plan → default plan", planOf(db, v, now).id === "none");
db.settings.defaultPlan = "trial";
check("changing the default plan applies to users without one", planOf(db, newbie, now).id === "trial");

// cleanPlan validation
const bad = (raw) => { try { cleanPlan(raw); return false; } catch (e) { return e.status === 400; } };
check("plan id must be latin, 2-20 chars", bad({ id: "پلن", name: "x" }) && bad({ id: "a", name: "x" }) && !bad({ id: "gold-1", name: "طلایی" }));
check("plan name required", bad({ id: "gold", name: " " }));
check("limits: negatives → 0, decimals floored, '' → unlimited", JSON.stringify(cleanPlan({ id: "g1", name: "g", reelsPerDay: -3, reelsPerMonth: 4.7, postsPerDay: "" })) ===
  JSON.stringify({ id: "g1", name: "g", reelsPerDay: 0, reelsPerMonth: 4, postsPerDay: null }));

console.table(results);
process.exit(results.every((r) => r.ok === "PASS") ? 0 : 1);
