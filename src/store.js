// Tiny JSON-file store. Fine for a demo with a handful of users; swap for SQLite/Postgres later.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// DATA_DIR lets tests / demo runs use their own copy (e.g. DATA_DIR=data-demo) without touching real data
export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = fs.existsSync(DB_FILE)
  ? JSON.parse(fs.readFileSync(DB_FILE, "utf8"))
  : { users: {}, sessions: {}, jobs: [] };

export const uploadDir = UPLOAD_DIR;
export const getDb = () => db;
export const newId = (n = 10) => crypto.randomBytes(n).toString("base64url").slice(0, n);

// atomic: write a temp file, then rename over db.json, so a kill mid-write never leaves a half-written db.json
function writeNow() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}

let saveTimer = null;
export function save() {
  // debounce: many small updates (job status) → one write
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; writeNow(); }, 150);
}

/** Write a pending save right now (synchronously). Called on shutdown. */
export function flushSync() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeNow();
}

// Save base64 JPEG frames (data URLs) to disk; returns public URLs.
export function saveFrames(dataUrls, prefix) {
  return dataUrls.map((dataUrl, i) => {
    const b64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, "");
    const name = `${prefix}-${i}-${newId(6)}.jpg`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(b64, "base64"));
    return `/uploads/${name}`;
  });
}

export const readFrameB64 = (url) => fs.readFileSync(path.join(UPLOAD_DIR, path.basename(url))).toString("base64");

export function deleteFrames(urls = []) {
  for (const u of urls) fs.rmSync(path.join(UPLOAD_DIR, path.basename(u)), { force: true });
}
