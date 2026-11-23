import {contentRoutes} from './src/content-routes.js';
import {contentCatalog} from './src/content-catalog.js';
import {inspectContentMedia,VIDEO_REJECTED} from './src/content-media.js';
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { jobDir, extractAudio } from "./src/media.js";
import { getDb, save, flushSync, newId, saveFrames, deleteFrames, uploadDir } from "./src/store.js";
import { sendCode, verifyCode, requireUser, logout, smsEnabled } from "./src/auth.js";
import { demoMode, MODEL, transcribe } from "./src/ai.js";
import { enqueue } from "./src/jobs.js";
import { uploadRoutes, takeUpload, MAX_UPLOAD } from "./src/uploads.js";
import { ensurePlans, isAdmin, planView, quotaError, cleanPlan, usageOf, planOf } from "./src/plans.js";
import { editRoutes } from "./src/edit-routes.js";
import { pruneTemplateMedia } from "./src/media-retention.js";
import {publicJobError} from './src/user-errors.js';

// BASE_URL: the path the app is served under, e.g. "/creator" (or a full URL "https://x.com/creator": only its path
// is used), so it can sit next to other apps behind one reverse proxy. Empty = the root. The page uses relative
// URLs only, so it also works when a proxy strips the prefix.
const BASE = (() => {
  let b = String(process.env.BASE_URL || "").trim();
  try { b = new URL(b).pathname; } catch {}
  b = b.replace(/\/+$/, "");
  return b && !b.startsWith("/") ? "/" + b : b;
})();

const CONTENT_ONLY=process.env.APP_EDITION!=='studio-internal';
const db = getDb();
ensurePlans(db);
const app = express.Router();
app.use(express.json({ limit: "20mb" })); // only small JPEG frames arrive; videos never leave the phone
if(CONTENT_ONLY)app.use((req,res,next)=>{
 if(/^\/(media|uploads)(\/|$)/i.test(req.path))return res.sendStatus(404);
 if(req.path==='/api/templates'&&req.method==='GET')return requireUser(req,res,()=>res.json(contentCatalog.imageTemplates));
 if(/^\/api\/(edits|jobs|reels|voice)(\/|$)/i.test(req.path))return requireUser(req,res,()=>{if(req.method==='GET'&&['/api/edits','/api/jobs'].includes(req.path))return res.json([]);res.status(410).json({error:VIDEO_REJECTED});});
 next();
});
app.use(express.static("public"));
app.use("/uploads", express.static(uploadDir, { maxAge: "7d" }));
// finished reels: only out.mp4 / cover.jpg / thumb.jpg are served (not the raw uploads)
app.use("/media", (req, res, next) => (/^\/[\w-]+\/(out\.mp4|cover\.jpg|thumb\.jpg)$/.test(req.path)&&!db.jobs.some(j=>j.id===req.path.split('/')[1]&&j.isPreview) ? next() : res.sendStatus(404)),
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
const publicUser = (u) => ({ name: u.name, phone: u.phone, usage: u.usage, plan: planView(db, u), admin: isAdmin(u) || undefined });
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
const jobView = ({ userId, plan, transcript, spokenLang, brand, templateData, conversationSnapshot, analysisTraceId, renderTraceId, ...j }) => ({ ...j,error:publicJobError(j), revisable: j.templateId==='photo-motion'?templateData?.adVersion===2&&j.status==='done':j.templateId ? !!templateData && j.status === "done" : !!plan });

// ---------- health (no auth; for the container / proxy) ----------
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------- auth ----------
app.get("/api/config", (_req, res) => res.json({ uiProtocol: 2, edition:CONTENT_ONLY?"content-v1":"studio-internal", editProtocol:5,mediaEvidence:1,conversationContext: true, templateRevision: true, demoMode, smsEnabled, model: MODEL, maxUploadBytes: CONTENT_ONLY?25*1048576:MAX_UPLOAD }));
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

// Legacy style/sample/brand preferences are retired; existing data stays untouched.
app.all(["/api/style", "/api/samples", "/api/samples/:id", "/api/brand", "/api/brand/logo"], requireUser, (_req,res) =>
  res.status(410).json({ error: "تنظیمات عمومی حذف شده؛ قالب انتخاب کن." }));

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
  const file = path.join(os.tmpdir(), `voice-${newId(8)}.${ext}`), mp3 = file + ".mp3";
  fs.writeFileSync(file, req.body);
  try {
    // the phone's webm has no duration in its header and the API refuses it ("webm duration parsing…") →
    // re-encode to a small mono mp3 first (same as the reels' own speech)
    try { await extractAudio(file, mp3, 180); }
    catch { return res.status(400).json({ error: "این صدا خونده نشد. دوباره ضبط کن." }); }
    const r = await transcribe(mp3, "fa");
    v.n++;
    req.user.usage ??= { tokens: 0, cost: 0 };
    req.user.usage.cost = (req.user.usage.cost || 0) + (r.cost || 0);
    save();
    const text = r.segments.map((x) => x.text).join(" ").replace(/\s+/g, " ").trim();
    if (!text) return res.status(400).json({ error: "صدایی شنیده نشد. نزدیک‌تر به گوشی حرف بزن." });
    res.json({ text });
  } finally { fs.rmSync(file, { force: true }); fs.rmSync(mp3, { force: true }); }
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

// New creation must go through template requirements; historical jobs remain readable.
app.post("/api/jobs", requireUser, wrap(async (req,res) => {
  quota(req.user,"post");
  res.status(410).json({ error: "برای ساخت، اول قالب انتخاب کن." });
}));

// ---------- resumable uploads (src/uploads.js) ----------
uploadRoutes(app, { db, save, requireUser, wrap, canUpload: (user) => {if(!CONTENT_ONLY)quota(user,"reel");}, validateUpload:CONTENT_ONLY?inspectContentMedia:null, maxBytes:CONTENT_ONLY?25*1048576:MAX_UPLOAD });
if(CONTENT_ONLY)contentRoutes(app,{db,save,requireUser,wrap});
editRoutes(app, { db, save, requireUser, wrap, quota, enqueue });
const cleanTemplateMedia=()=>{try{if(pruneTemplateMedia(db))save();}catch(e){console.error("template cleanup",e.message);}};
cleanTemplateMedia();setInterval(cleanTemplateMedia,3600000).unref();

app.post(["/api/reels", "/api/reels/:id/start"], requireUser, wrap(async(req,res) => {
  quota(req.user,"reel");
  res.status(410).json({ error: "برای ساخت، اول قالب انتخاب کن." });
}));

app.get("/api/jobs", requireUser, (req, res) =>
  res.json(db.jobs.filter((j) => j.userId === req.user.id&&!j.isPreview&&!j.previewCancelled).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map(jobView))
);
app.get("/api/jobs/:id", requireUser, (req,res)=>{
  const job=db.jobs.find(j=>j.id===req.params.id&&j.userId===req.user.id);
  if(!job)return res.status(404).json({error:"این ویدیو پیدا نشد."});
  res.set("Cache-Control","private, no-store").json(jobView(job));
});

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
  if(job.templateId==='photo-motion'&&(job.previewCancelled||!db.edits.some(e=>e.id===job.editId&&!e.archived&&!e.jobId&&e.previewJobId===job.id)))return res.status(409).json({error:'این پیش‌نمایش فعال نیست.'});
  quota(req.user, job.kind === "reel" ? "reel" : "post");
  if (job.kind === "reel" && !job.inputs.every((i) => fs.existsSync(path.join(jobDir(job.id), i.file))))
    return res.status(400).json({ error: "فایل‌های این ریلز دیگه نیست. دوباره بفرست." });
  Object.assign(job, { status: "queued", error: null });
  if(job.templateId==='photo-motion')job.imageAttempt=newId();
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
server.listen(port, process.env.HOST || "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log(`Content Creator Expert  ${demoMode ? "(DEMO: no GAPGPT_API_KEY)" : `(model: ${MODEL})`}  ${smsEnabled ? "" : "(SMS off: codes are shown on screen)"}`);
  console.log(`  this computer:  http://localhost:${port}${BASE}/`);
  for (const ip of ips) console.log(`  on your phone:  http://${ip}:${port}${BASE}/`);
  if (!process.env.ADMIN_PHONE) console.log("  (no ADMIN_PHONE: nobody can open the admin page)");
});
