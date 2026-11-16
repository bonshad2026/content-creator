import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { jobDir } from "./src/media.js";
import { getDb, save, flushSync, newId, saveFrames, deleteFrames, uploadDir } from "./src/store.js";
import { sendCode, verifyCode, requireUser, logout, smsEnabled } from "./src/auth.js";
import { demoMode, MODEL, transcribe } from "./src/ai.js";
import { enqueue } from "./src/jobs.js";
import { uploadRoutes, takeUpload, MAX_UPLOAD } from "./src/uploads.js";
import { ensurePlans, isAdmin, planView, quotaError, cleanPlan, usageOf, planOf } from "./src/plans.js";

// BASE_URL: the path the app is served under, e.g. "/creator" (or a full URL "https://x.com/creator": only its path
// is used), so it can sit next to other apps behind one reverse proxy. Empty = the root. The page uses relative
// URLs only, so it also works when a proxy strips the prefix.
const BASE = (() => {
  let b = String(process.env.BASE_URL || "").trim();
  try { b = new URL(b).pathname; } catch {}
  b = b.replace(/\/+$/, "");
  return b && !b.startsWith("/") ? "/" + b : b;
})();

const db = getDb();
ensurePlans(db);
const app = express.Router();
app.use(express.json({ limit: "20mb" })); // only small JPEG frames arrive; videos never leave the phone
app.use(express.static("public"));
app.use("/uploads", express.static(uploadDir, { maxAge: "7d" }));
// finished reels: only out.mp4 / cover.jpg / thumb.jpg are served (not the raw uploads)
app.use("/media", (req, res, next) => (/^\/[\w-]+\/(out\.mp4|cover\.jpg|thumb\.jpg)$/.test(req.path) ? next() : res.sendStatus(404)),
  express.static(path.resolve(process.env.DATA_DIR || "data", "jobs")));

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.message || "خطا" });
  }
};
const MAX_FRAMES = 6;
const publicUser = (u) => ({ name: u.name, phone: u.phone, style: u.style, samples: u.samples, usage: u.usage, brand: u.brand || null, plan: planView(db, u), admin: isAdmin(u) || undefined });
// plan limits: checked before any job that spends AI tokens is created (reel, revise, post) or retried
const quota = (user, kind) => {
  const msg = quotaError(db, user, kind);
  if (msg) throw Object.assign(new Error(msg), { status: 403 });
};
// brand kit as the renderer needs it (absolute logo path); copied onto each job so later edits look the same
const brandSnapshot = (u) => {
  const b = u.brand;
  if (!b) return null;
  return { color: b.color, handle: b.handle, outro: !!b.outro, watermark: !!b.watermark, logo: b.logo ? path.join(uploadDir, path.basename(b.logo)) : null };
};
// (the edit plan / transcript / brand paths stay on the server; the app only needs to know a reel can be revised)
const jobView = ({ userId, plan, transcript, spokenLang, brand, ...j }) => ({ ...j, revisable: !!plan });

// ---------- health (no auth; for the container / proxy) ----------
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------- auth ----------
app.get("/api/config", (_req, res) => res.json({ demoMode, smsEnabled, model: MODEL }));
app.post("/api/auth/send", wrap(async (req, res) => res.json(await sendCode(req.body.phone))));
app.post("/api/auth/verify", wrap(async (req, res) => {
  const { token, user } = verifyCode(req.body.phone, req.body.code);
  res.json({ token, user: publicUser(user) });
}));
app.post("/api/auth/logout", requireUser, (req, res) => (logout(req.token), res.json({ ok: true })));

// ---------- profile & style ----------
app.get("/api/me", requireUser, (req, res) => res.json(publicUser(req.user)));
app.put("/api/me", requireUser, (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: "اسم را وارد کنید." });
  req.user.name = name;
  save();
  res.json(publicUser(req.user));
});

app.put("/api/style", requireUser, (req, res) => {
  const s = req.body || {};
  const pick = (v, n = 60) => String(v || "").slice(0, n);
  const list = (v) => (Array.isArray(v) ? v.slice(0, 5).map((x) => pick(x)) : []);
  req.user.style = {
    platform: pick(s.platform), niche: pick(s.niche), tone: list(s.tone), language: pick(s.language),
    audience: list(s.audience), length: pick(s.length), emoji: pick(s.emoji), hashtags: pick(s.hashtags),
    cta: pick(s.cta), description: pick(s.description, 600),
  };
  save();
  res.json(publicUser(req.user));
});

app.post("/api/samples", requireUser, (req, res) => {
  const { kind = "image", frames = [] } = req.body;
  if (!frames.length) return res.status(400).json({ error: "فایلی نیامد." });
  if (req.user.samples.length >= 12) return res.status(400).json({ error: "حداکثر ۱۲ نمونه‌کار." });
  const id = newId();
  req.user.samples.push({ id, kind: kind === "video" ? "video" : "image", frames: saveFrames(frames.slice(0, 2), `s-${id}`) });
  save();
  res.json(publicUser(req.user));
});

app.delete("/api/samples/:id", requireUser, (req, res) => {
  const s = req.user.samples.find((x) => x.id === req.params.id);
  if (s) deleteFrames(s.frames);
  req.user.samples = req.user.samples.filter((x) => x.id !== req.params.id);
  save();
  res.json(publicUser(req.user));
});

// ---------- brand kit: accent colour, @handle, logo, outro card, watermark ----------
app.put("/api/brand", requireUser, (req, res) => {
  const b = req.body || {};
  const color = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : "#FFD400";
  const handle = String(b.handle || "").trim().slice(0, 40);
  req.user.brand = { ...(req.user.brand || {}), color, handle, outro: !!b.outro, watermark: !!b.watermark };
  save();
  res.json(publicUser(req.user));
});
app.post("/api/brand/logo", requireUser, (req, res) => {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(String(req.body.dataUrl || ""));
  if (!m) return res.status(400).json({ error: "عکس لوگو نامعتبر است." });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 2 * 1024 * 1024) return res.status(400).json({ error: "لوگو خیلی بزرگ است." });
  const old = req.user.brand?.logo;
  if (old) deleteFrames([old]);
  const name = `logo-${req.user.id}-${newId(6)}.png`;
  fs.writeFileSync(path.join(uploadDir, name), buf);
  req.user.brand = { color: "#FFD400", handle: "", outro: true, watermark: false, ...(req.user.brand || {}), logo: `/uploads/${name}` };
  save();
  res.json(publicUser(req.user));
});
app.delete("/api/brand/logo", requireUser, (req, res) => {
  if (req.user.brand?.logo) deleteFrames([req.user.brand.logo]);
  if (req.user.brand) req.user.brand.logo = null;
  save();
  res.json(publicUser(req.user));
});

// ---------- voice note → text (the brief or a revise request, spoken instead of typed) ----------
// Raw audio body (what the phone's MediaRecorder makes: webm / ogg / mp4), max ~3 min. Whisper, Persian.
// A daily cap per user keeps the cost bounded (Whisper: $0.006 a minute).
const VOICE_MAX = 4 * 1024 * 1024, VOICE_PER_DAY = 40;
const VOICE_EXT = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a" };
app.post("/api/voice", requireUser, express.raw({ type: "audio/*", limit: VOICE_MAX }), wrap(async (req, res) => {
  const type = String(req.get("content-type") || "").split(";")[0].trim();
  const ext = VOICE_EXT[type];
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length < 500) return res.status(400).json({ error: "صدا ضبط نشد. دوباره امتحان کن." });
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });
  const v = req.user.voice?.day === day ? req.user.voice : (req.user.voice = { day, n: 0 });
  if (!isAdmin(req.user) && v.n >= VOICE_PER_DAY) return res.status(429).json({ error: "امروز به اندازه‌ی کافی صدا فرستادی. بقیه‌ش رو تایپ کن." });
  if (demoMode) { v.n++; save(); return res.json({ text: "(دمو) این متنِ صدای توئه؛ با کلید واقعی، حرفت اینجا نوشته می‌شه." }); }
  const file = path.join(os.tmpdir(), `voice-${newId(8)}.${ext}`);
  fs.writeFileSync(file, req.body);
  try {
    const r = await transcribe(file, "fa");
    v.n++;
    req.user.usage ??= { tokens: 0, cost: 0 };
    req.user.usage.cost = (req.user.usage.cost || 0) + (r.cost || 0);
    save();
    const text = r.segments.map((x) => x.text).join(" ").replace(/s+/g, " ").trim();
    if (!text) return res.status(400).json({ error: "صدایی شنیده نشد. نزدیک‌تر به گوشی حرف بزن." });
    res.json({ text });
  } finally { fs.rmSync(file, { force: true }); }
}));

// ---------- feedback (👍 / 👎 + note) and "revise" ----------
const rememberTaste = (user, note) => {
  if (!note) return;
  user.taste = [...(user.taste || []), note.slice(0, 160)].slice(-12);
};
app.post("/api/jobs/:id/feedback", requireUser, (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id && j.userId === req.user.id);
  if (!job) return res.status(404).json({ error: "پیدا نشد." });
  const rating = req.body.rating === 1 ? 1 : req.body.rating === -1 ? -1 : 0;
  const note = String(req.body.note || "").trim().slice(0, 1000);
  job.feedback = { rating, note, at: Date.now() };
  if (note) rememberTaste(req.user, rating < 0 ? `didn't like: ${note}` : `liked: ${note}`);
  save();
  res.json(jobView(job));
});
app.post("/api/jobs/:id/revise", requireUser, wrap(async (req, res) => {
  quota(req.user, "reel");
  const parent = db.jobs.find((j) => j.id === req.params.id && j.userId === req.user.id);
  const note = String(req.body.note || "").trim().slice(0, 1000);
  if (!parent || parent.kind !== "reel" || parent.status !== "done") return res.status(400).json({ error: "این ریلز قابل ویرایش نیست." });
  if (!parent.plan) return res.status(400).json({ error: "این ریلز با نسخه‌ی قدیمی ساخته شده؛ یک ریلز تازه بساز." });
  if (!note) return res.status(400).json({ error: "بنویس چه چیزی عوض شود." });
  const id = newId();
  const from = jobDir(parent.id), to = jobDir(id);
  for (const i of parent.inputs) {
    // hard link when possible (no extra disk), copy otherwise
    try {
      fs.linkSync(path.join(from, i.file), path.join(to, i.file));
    } catch {
      fs.copyFileSync(path.join(from, i.file), path.join(to, i.file));
    }
  }
  const job = {
    id, userId: req.user.id, kind: "reel", brief: parent.brief, length: parent.length ?? null, frames: [], inputs: parent.inputs.map((i) => ({ ...i })),
    revise: { parentId: parent.id, note }, brand: parent.brand ?? brandSnapshot(req.user),
    status: "queued", stage: null, output: null, error: null, usage: { tokens: 0, cost: 0 }, createdAt: Date.now(),
  };
  rememberTaste(req.user, `asked to change: ${note}`);
  db.jobs.push(job);
  save();
  enqueue(job);
  res.json(jobView(job));
}));

// ---------- generation jobs ----------
app.post("/api/jobs", requireUser, wrap(async (req, res) => {
  quota(req.user, "post");
  if (!req.user.style) return res.status(400).json({ error: "اول سبکت را مشخص کن." });
  const { kind = "image", frames = [], brief = "" } = req.body;
  if (!frames.length) return res.status(400).json({ error: "عکس یا ویدیو انتخاب کن." });
  const id = newId();
  const job = {
    id, userId: req.user.id, kind: ["video", "carousel"].includes(kind) ? kind : "image",
    brief: String(brief).slice(0, 1500), frames: saveFrames(frames.slice(0, MAX_FRAMES), `j-${id}`),
    status: "queued", output: null, error: null, usage: { tokens: 0, cost: 0 }, createdAt: Date.now(),
  };
  db.jobs.push(job);
  save();
  enqueue(job);
  res.json(jobView(job));
}));

// ---------- resumable uploads (src/uploads.js) ----------
uploadRoutes(app, { db, save, requireUser, wrap, canUpload: (user) => quota(user, "reel") });

// ---------- video reels: upload each file (resumable) → create with the upload ids → start ----------
// (the older "create → PUT each file" flow still works)
app.post("/api/reels", requireUser, wrap(async (req, res) => {
  quota(req.user, "reel");
  if (!req.user.style) return res.status(400).json({ error: "اول سبکت را مشخص کن." });
  const files = (req.body.files || []).slice(0, 10);
  if (!files.length) return res.status(400).json({ error: "فایلی انتخاب نشده." });
  const id = newId();
  const job = {
    id, userId: req.user.id, kind: "reel", brief: String(req.body.brief || "").slice(0, 1500), frames: [],
    // chosen reel length (s); null = from the brief or the material
    length: [15, 30, 60].includes(Number(req.body.length)) ? Number(req.body.length) : null,
    inputs: files.map((f, i) => ({ n: i + 1, type: f.type === "image" ? "image" : "video", file: `in${i + 1}.${f.type === "image" ? "jpg" : "mp4"}`, uploaded: false })),
    brand: brandSnapshot(req.user), status: "uploading", stage: null, output: null, error: null, usage: { tokens: 0, cost: 0 }, createdAt: Date.now(),
  };
  const dir = jobDir(id);
  try {
    files.forEach((f, i) => { if (f.upload) { takeUpload(db, req.user, String(f.upload), path.join(dir, job.inputs[i].file)); job.inputs[i].uploaded = true; } });
  } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
  db.jobs.push(job);
  save();
  res.json(jobView(job));
}));

app.put("/api/reels/:id/files/:n", requireUser, (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id && j.userId === req.user.id && j.status === "uploading");
  const inp = job?.inputs.find((i) => i.n === Number(req.params.n));
  if (!inp) return res.status(404).json({ error: "پیدا نشد." });
  const target = path.join(jobDir(job.id), inp.file);
  const out = fs.createWriteStream(target);
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_UPLOAD) { req.destroy(); out.destroy(); fs.rmSync(target, { force: true }); }
  });
  // phone dropped the connection mid-upload → remove the partial file (the app retries the whole file)
  req.on("aborted", () => { out.destroy(); fs.rmSync(target, { force: true }); });
  req.pipe(out);
  out.on("finish", () => {
    if (size > MAX_UPLOAD) return;
    inp.uploaded = true;
    save();
    res.json({ ok: true });
  });
  req.on("close", () => { if (size > MAX_UPLOAD && !res.headersSent) res.status(413).json({ error: "فایل خیلی بزرگ است (حداکثر ۴۰۰ مگابایت)." }); });
});

app.post("/api/reels/:id/start", requireUser, (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id && j.userId === req.user.id && j.status === "uploading");
  if (!job) return res.status(404).json({ error: "پیدا نشد." });
  if (!job.inputs.every((i) => i.uploaded)) return res.status(400).json({ error: "آپلود کامل نشده." });
  job.status = "queued";
  save();
  enqueue(job);
  res.json(jobView(job));
});

app.get("/api/jobs", requireUser, (req, res) =>
  res.json(db.jobs.filter((j) => j.userId === req.user.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map(jobView))
);

app.delete("/api/jobs/:id", requireUser, (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id && j.userId === req.user.id);
  if (job && job.status !== "running" && job.status !== "queued") {
    deleteFrames(job.frames);
    if (job.kind === "reel") fs.rmSync(jobDir(job.id), { recursive: true, force: true });
    db.jobs = db.jobs.filter((j) => j !== job);
    save();
  }
  res.json({ ok: true });
});

app.post("/api/jobs/:id/retry", requireUser, wrap(async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id && j.userId === req.user.id);
  if (!job || job.status !== "error") return res.status(400).json({ error: "قابل تکرار نیست." });
  quota(req.user, job.kind === "reel" ? "reel" : "post");
  if (job.kind === "reel" && !job.inputs.every((i) => fs.existsSync(path.join(jobDir(job.id), i.file))))
    return res.status(400).json({ error: "فایل‌های این ریلز دیگه نیست. دوباره بفرست." });
  Object.assign(job, { status: "queued", error: null });
  save();
  enqueue(job);
  res.json(jobView(job));
}));

// ---------- admin: users and their plans, the plans themselves (only ADMIN_PHONE) ----------
const requireAdmin = [requireUser, (req, res, next) => (isAdmin(req.user) ? next() : res.status(403).json({ error: "دسترسی ندارید." }))];
const adminUser = (u) => {
  const jobs = db.jobs.filter((j) => j.userId === u.id);
  return {
    id: u.id, phone: u.phone, name: u.name, createdAt: u.createdAt, admin: isAdmin(u) || undefined,
    plan: u.plan || null, planUntil: u.planUntil || null, effective: planOf(db, u).id, note: u.adminNote || "",
    used: usageOf(db, u), jobs: jobs.length, failed: jobs.filter((j) => j.status === "error").length,
    lastAt: jobs.reduce((a, j) => Math.max(a, j.createdAt), 0) || null, tokens: u.usage?.tokens || 0, cost: u.usage?.cost || 0,
  };
};
app.get("/api/admin", requireAdmin, (_req, res) => res.json({
  plans: Object.values(db.plans), defaultPlan: db.settings.defaultPlan,
  users: Object.values(db.users).map(adminUser).sort((a, b) => (b.lastAt || b.createdAt || 0) - (a.lastAt || a.createdAt || 0)),
}));
app.put("/api/admin/users/:id", requireAdmin, wrap(async (req, res) => {
  const u = db.users[req.params.id];
  if (!u) return res.status(404).json({ error: "کاربر پیدا نشد." });
  const { plan, until, note } = req.body || {};
  if (plan !== undefined) {
    if (plan !== null && !db.plans[plan]) return res.status(400).json({ error: "این پلن وجود ندارد." });
    u.plan = plan || null;
  }
  if (until !== undefined) {
    const t = until ? Date.parse(until) : null;
    if (until && !Number.isFinite(t)) return res.status(400).json({ error: "تاریخ پایان نامعتبر است." });
    u.planUntil = t;
  }
  if (note !== undefined) u.adminNote = String(note || "").slice(0, 200);
  save();
  res.json(adminUser(u));
}));
app.put("/api/admin/plans/:id", requireAdmin, wrap(async (req, res) => {
  const p = cleanPlan({ ...req.body, id: req.params.id });
  db.plans[p.id] = p;
  save();
  res.json(p);
}));
app.delete("/api/admin/plans/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  if (id === "none") return res.status(400).json({ error: "پلن «غیرفعال» حذف نمی‌شود." });
  if (id === db.settings.defaultPlan) return res.status(400).json({ error: "اول پلن پیش‌فرض را عوض کنید." });
  delete db.plans[id]; // users still on it fall back to the default plan (planOf)
  save();
  res.json({ ok: true });
});
app.put("/api/admin/settings", requireAdmin, (req, res) => {
  if (!db.plans[req.body?.defaultPlan]) return res.status(400).json({ error: "این پلن وجود ندارد." });
  db.settings.defaultPlan = req.body.defaultPlan;
  save();
  res.json({ defaultPlan: db.settings.defaultPlan });
});

// uploads left unfinished for 15 min (phone closed the page, lost Wi-Fi…) → mark failed and free the disk
setInterval(() => {
  let changed = false;
  for (const j of db.jobs)
    if (j.status === "uploading" && Date.now() - j.createdAt > 15 * 60_000) {
      fs.rmSync(jobDir(j.id), { recursive: true, force: true });
      Object.assign(j, { status: "error", error: "آپلود ناقص ماند. دوباره بفرست.", finishedAt: Date.now() });
      changed = true;
    }
  if (changed) save();
}, 60_000);

// ---------- start (listen on all interfaces so phones on the same Wi-Fi can connect) ----------
const port = Number(process.env.PORT || 3001);
const server = express();
server.disable("x-powered-by");
// "/creator" → "/creator/": the page's relative URLs need the trailing slash
if (BASE) server.use((req, res, next) => (req.path === BASE ? res.redirect(301, BASE + "/" + (req.originalUrl.slice(BASE.length) || "")) : next()));
server.use(BASE || "/", app);
// shutdown (supervisord sends SIGTERM on every deploy): write a pending db save first, then exit.
// Unfinished jobs are picked up again on the next start (jobs.js).
for (const sig of ["SIGTERM", "SIGINT"])
  process.once(sig, () => {
    try { flushSync(); } catch (e) { console.error("db flush failed:", e); }
    process.exit(0);
  });
server.listen(port, "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log(`Content Creator Expert  ${demoMode ? "(DEMO: no GAPGPT_API_KEY)" : `(model: ${MODEL})`}  ${smsEnabled ? "" : "(SMS off: codes are shown on screen)"}`);
  console.log(`  this computer:  http://localhost:${port}${BASE}/`);
  for (const ip of ips) console.log(`  on your phone:  http://${ip}:${port}${BASE}/`);
  if (!process.env.ADMIN_PHONE) console.log("  (no ADMIN_PHONE: nobody can open the admin page)");
});
