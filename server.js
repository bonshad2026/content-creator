import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { jobDir } from "./src/media.js";
import { getDb, save, newId, saveFrames, deleteFrames, uploadDir } from "./src/store.js";
import { sendCode, verifyCode, requireUser, logout, smsEnabled } from "./src/auth.js";
import { demoMode, MODEL } from "./src/ai.js";
import { enqueue } from "./src/jobs.js";

const db = getDb();
const app = express();
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
const publicUser = (u) => ({ name: u.name, phone: u.phone, style: u.style, samples: u.samples, usage: u.usage, brand: u.brand || null });
// brand kit as the renderer needs it (absolute logo path); copied onto each job so later edits look the same
const brandSnapshot = (u) => {
  const b = u.brand;
  if (!b) return null;
  return { color: b.color, handle: b.handle, outro: !!b.outro, watermark: !!b.watermark, logo: b.logo ? path.join(uploadDir, path.basename(b.logo)) : null };
};
// (the edit plan / transcript / brand paths stay on the server; the app only needs to know a reel can be revised)
const jobView = ({ userId, plan, transcript, spokenLang, brand, ...j }) => ({ ...j, revisable: !!plan });

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

// ---------- feedback (👍 / 👎 + note) and "revise" ----------
const rememberTaste = (user, note) => {
  if (!note) return;
  user.taste = [...(user.taste || []), note.slice(0, 160)].slice(-12);
};
app.post("/api/jobs/:id/feedback", requireUser, (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id && j.userId === req.user.id);
  if (!job) return res.status(404).json({ error: "پیدا نشد." });
  const rating = req.body.rating === 1 ? 1 : req.body.rating === -1 ? -1 : 0;
  const note = String(req.body.note || "").trim().slice(0, 300);
  job.feedback = { rating, note, at: Date.now() };
  if (note) rememberTaste(req.user, rating < 0 ? `didn't like: ${note}` : `liked: ${note}`);
  save();
  res.json(jobView(job));
});
app.post("/api/jobs/:id/revise", requireUser, (req, res) => {
  const parent = db.jobs.find((j) => j.id === req.params.id && j.userId === req.user.id);
  const note = String(req.body.note || "").trim().slice(0, 300);
  if (!parent || parent.kind !== "reel" || parent.status !== "done") return res.status(400).json({ error: "این ریل قابل ویرایش نیست." });
  if (!parent.plan) return res.status(400).json({ error: "این ریل با نسخه‌ی قدیمی ساخته شده؛ یک ریل تازه بساز." });
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
    id, userId: req.user.id, kind: "reel", brief: parent.brief, frames: [], inputs: parent.inputs.map((i) => ({ ...i })),
    revise: { parentId: parent.id, note }, brand: parent.brand ?? brandSnapshot(req.user),
    status: "queued", stage: null, output: null, error: null, usage: { tokens: 0, cost: 0 }, createdAt: Date.now(),
  };
  rememberTaste(req.user, `asked to change: ${note}`);
  db.jobs.push(job);
  save();
  enqueue(job);
  res.json(jobView(job));
});

// ---------- generation jobs ----------
app.post("/api/jobs", requireUser, (req, res) => {
  if (!req.user.style) return res.status(400).json({ error: "اول سبکت را مشخص کن." });
  const { kind = "image", frames = [], brief = "" } = req.body;
  if (!frames.length) return res.status(400).json({ error: "عکس یا ویدیو انتخاب کن." });
  const id = newId();
  const job = {
    id, userId: req.user.id, kind: ["video", "carousel"].includes(kind) ? kind : "image",
    brief: String(brief).slice(0, 300), frames: saveFrames(frames.slice(0, MAX_FRAMES), `j-${id}`),
    status: "queued", output: null, error: null, usage: { tokens: 0, cost: 0 }, createdAt: Date.now(),
  };
  db.jobs.push(job);
  save();
  enqueue(job);
  res.json(jobView(job));
});

// ---------- video reels: create → upload each file (raw stream) → start ----------
const MAX_UPLOAD = 400 * 1024 * 1024; // per file
app.post("/api/reels", requireUser, (req, res) => {
  if (!req.user.style) return res.status(400).json({ error: "اول سبکت را مشخص کن." });
  const files = (req.body.files || []).slice(0, 10);
  if (!files.length) return res.status(400).json({ error: "فایلی انتخاب نشده." });
  const id = newId();
  const job = {
    id, userId: req.user.id, kind: "reel", brief: String(req.body.brief || "").slice(0, 300), frames: [],
    inputs: files.map((f, i) => ({ n: i + 1, type: f.type === "image" ? "image" : "video", file: `in${i + 1}.${f.type === "image" ? "jpg" : "mp4"}`, uploaded: false })),
    brand: brandSnapshot(req.user), status: "uploading", stage: null, output: null, error: null, usage: { tokens: 0, cost: 0 }, createdAt: Date.now(),
  };
  jobDir(id);
  db.jobs.push(job);
  save();
  res.json(jobView(job));
});

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

app.post("/api/jobs/:id/retry", requireUser, (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id && j.userId === req.user.id);
  if (!job || job.status !== "error") return res.status(400).json({ error: "قابل تکرار نیست." });
  if (job.kind === "reel" && !job.inputs.every((i) => fs.existsSync(path.join(jobDir(job.id), i.file))))
    return res.status(400).json({ error: "فایل‌های این ریل دیگه نیست. دوباره بفرست." });
  Object.assign(job, { status: "queued", error: null });
  save();
  enqueue(job);
  res.json(jobView(job));
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
app.listen(port, "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log(`Content Creator Expert  ${demoMode ? "(DEMO: no GAPGPT_API_KEY)" : `(model: ${MODEL})`}  ${smsEnabled ? "" : "(SMS off: codes are shown on screen)"}`);
  console.log(`  this computer:  http://localhost:${port}`);
  for (const ip of ips) console.log(`  on your phone:  http://${ip}:${port}`);
});
