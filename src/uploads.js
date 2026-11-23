// Resumable uploads (slow / dropping mobile connections).
// The phone sends a file in small chunks; each chunk says where it starts (Upload-Offset). If the connection drops,
// the phone asks how much arrived and goes on from there, never from zero.
// A file is known by a fingerprint the phone makes (size + a hash of a few sampled pieces), per user: picking the same
// file again (retry, page reload, a failed reel) finds the bytes already here and skips them, or the whole file.
// Files stay a few days after their last use, then are removed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./store.js";

const configuredMB = Number(process.env.MAX_UPLOAD_MB || 1024);
export const MAX_UPLOAD = (Number.isFinite(configuredMB) && configuredMB > 0 ? Math.floor(configuredMB) : 1024) * 1024 * 1024;
const limitMessage = `فایل خیلی بزرگ است؛ حداکثر ${String(MAX_UPLOAD / 1048576).replace(/\d/g,d=>"۰۱۲۳۴۵۶۷۸۹"[d])} مگابایت.`;
const MAX_CHUNK = 16 * 1024 * 1024;
const KEEP_MS = 3 * 86_400_000;
const PARTS_DIR = path.join(DATA_DIR, "parts");
fs.mkdirSync(PARTS_DIR, { recursive: true });

const err = (status, message) => Object.assign(new Error(message), { status });
const fileOf = (id) => path.join(PARTS_DIR, id);
const sizeOnDisk = (id) => { try { return fs.statSync(fileOf(id)).size; } catch { return 0; } };
const view = (u) => { const received = sizeOnDisk(u.id); return { id: u.id, size: u.size, received, done: received === u.size }; };

// one write per upload at a time; a new request for the same upload replaces a hung one (the phone gave up on it)
const active = new Map(); // id → { req, closed: Promise }

export function uploadRoutes(app, { db, save, requireUser, wrap, canUpload = () => {}, validateUpload=null, maxBytes=MAX_UPLOAD }) {
  db.uploads ??= {};

  // start or find: {key, size} → {id, size, received, done}
  app.post("/api/uploads", requireUser, wrap(async (req, res) => {
    const key = String(req.body?.key || ""), size = Number(req.body?.size);
    if (!/^[a-z0-9]{8,80}$/.test(key) || !Number.isInteger(size) || size <= 0) throw err(400, "فایل نامعتبر است.");
    if (size > maxBytes) throw err(413, maxBytes===MAX_UPLOAD?limitMessage:'حداکثر حجم فایل ۲۵ مگابایت است.');
    canUpload(req.user); // throws if the user's plan allows no reel now (no point sending 400 MB first)
    const id = crypto.createHash("sha256").update(`${req.user.id}:${key}:${size}`).digest("base64url").slice(0, 24);
    const u = (db.uploads[id] ??= { id, userId: req.user.id, size, createdAt: Date.now() });
    if(validateUpload&&sizeOnDisk(u.id)===u.size&&!u.contentValidated){try{u.contentKind=(await validateUpload(fileOf(u.id))).kind;u.contentValidated=true;}catch(error){fs.rmSync(fileOf(u.id),{force:true});delete db.uploads[u.id];save();throw error;}}
    u.touchedAt = Date.now();
    save();
    res.json(view(u));
  }));

  // how much arrived (after a drop)
  app.get("/api/uploads/:id", requireUser, (req, res) => {
    const u = db.uploads[req.params.id];
    if (!u || u.userId !== req.user.id) return res.status(404).json({ error: "پیدا نشد." });
    res.json(view(u));
  });

  // one chunk: raw body, header Upload-Offset = where it starts (must be what is already here)
  app.put("/api/uploads/:id", requireUser, wrap(async (req, res) => {
    const u = db.uploads[req.params.id];
    if (!u || u.userId !== req.user.id) throw err(404, "پیدا نشد.");
    const prev = active.get(u.id);
    if (prev) { prev.req.destroy(); await prev.closed; }
    const have = sizeOnDisk(u.id), offset = Number(req.get("Upload-Offset"));
    if (offset !== have) return res.status(409).json(view(u)); // the phone re-syncs from `received`
    const room = Math.min(MAX_CHUNK, u.size - have);
    const out = fs.createWriteStream(fileOf(u.id), { flags: "a" });
    let n = 0, tooBig = false;
    const closed = new Promise((r) => out.on("close", r));
    const me = { req, closed };
    active.set(u.id, me);
    const stop = (c) => { if (!out.writableEnded) out.end(c); };
    req.on("data", (c) => {
      if (tooBig) return;
      if (n + c.length > room) { tooBig = true; stop(c.subarray(0, room - n)); return; }
      n += c.length;
      if (!out.write(c)) { req.pause(); out.once("drain", () => req.resume()); }
    });
    // end, drop or replaced: keep what arrived, the next request goes on from there
    for (const ev of ["end", "aborted", "error", "close"]) req.on(ev, () => stop());
    await closed;
    if (active.get(u.id) === me) active.delete(u.id);
    u.touchedAt = Date.now();
    save();
    if (tooBig) return res.status(413).json({ error: "بیشتر از اندازه‌ی فایل." });
    if(validateUpload&&sizeOnDisk(u.id)===u.size){try{u.contentKind=(await validateUpload(fileOf(u.id))).kind;u.contentValidated=true;save();}catch(error){fs.rmSync(fileOf(u.id),{force:true});delete db.uploads[u.id];save();throw error;}}
    if (!res.headersSent && res.socket && !res.socket.destroyed) res.json(view(u));
  }));

  // remove uploads not used for a few days (and files nobody knows about, e.g. after a db restore)
  const sweep = () => {
    const now = Date.now();
    let changed = false;
    for (const u of Object.values(db.uploads))
      if (now - (u.touchedAt || u.createdAt) > KEEP_MS && !active.has(u.id)) {
        fs.rmSync(fileOf(u.id), { force: true });
        delete db.uploads[u.id];
        changed = true;
      }
    for (const f of fs.readdirSync(PARTS_DIR)) if (!db.uploads[f]) fs.rmSync(fileOf(f), { force: true });
    if (changed) save();
  };
  sweep();
  setInterval(sweep, 3_600_000).unref();
}

/** A finished upload of this user → put it at `target` (hard link: no copy, no extra disk). Throws if not finished. */
export function takeUpload(db, user, id, target) {
  const u = db.uploads?.[id];
  if (!u || u.userId !== user.id || sizeOnDisk(u.id) !== u.size) throw err(400, "آپلود کامل نشده.");
  fs.rmSync(target, { force: true });
  try { fs.linkSync(fileOf(u.id), target); } catch { fs.copyFileSync(fileOf(u.id), target); }
  u.touchedAt = Date.now();
}
