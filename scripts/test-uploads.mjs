// Resumable uploads (offline, 0 tokens). Own data folder: never touches the real data/.
// Usage: npm run test:uploads
process.env.DATA_DIR = "data/test-out/uploads";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
const { uploadRoutes, takeUpload, MAX_UPLOAD } = await import("../src/uploads.js");

const results = [];
const check = (name, ok, note = "") => { console.log(ok ? "ok  " : "FAIL", name); results.push({ case: name, ok: ok ? "PASS" : "FAIL", note: String(note).slice(0, 90) }); };

const db = { users: { a: { id: "a" }, b: { id: "b" } } };
let blocked = false;
const app = express();
app.use(express.json());
const requireUser = (req, _res, next) => { req.user = db.users[req.get("x-user")]; next(); };
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
uploadRoutes(app, { db, save: () => {}, requireUser, wrap, canUpload: () => { if (blocked) throw Object.assign(new Error("no"), { status: 403 }); } });
const server = app.listen(0);
const port = server.address().port;

const call = (method, url, { user = "a", body, headers = {} } = {}) => new Promise((ok, bad) => {
  const raw = body && !Buffer.isBuffer(body) ? Buffer.from(JSON.stringify(body)) : body;
  const req = http.request({ port, method, path: url, headers: { "x-user": user, ...(raw && !Buffer.isBuffer(body) ? { "content-type": "application/json" } : { "content-type": "application/octet-stream" }), ...headers } }, (res) => {
    let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => ok({ status: res.statusCode, data: JSON.parse(s || "{}") }));
  });
  req.on("error", bad);
  req.end(raw);
});
// send `part` but cut the connection after `cut` bytes (a phone losing Wi-Fi mid-chunk)
const cutAfter = (id, offset, part, cut) => new Promise((ok) => {
  const req = http.request({ port, method: "PUT", path: `/api/uploads/${id}`, headers: { "x-user": "a", "upload-offset": offset, "content-type": "application/octet-stream", "content-length": part.length } });
  req.on("error", () => {});
  req.write(part.subarray(0, cut), () => setTimeout(() => { req.destroy(); setTimeout(ok, 150); }, 100));
});

const file = crypto.randomBytes(10 * 1024 * 1024 + 123);
const CH = 4 * 1024 * 1024;

let u = (await call("POST", "/api/uploads", { body: { key: "testkey0001", size: file.length } })).data;
check("start: nothing yet", u.received === 0 && !u.done, JSON.stringify(u));

u = (await call("PUT", `/api/uploads/${u.id}`, { body: file.subarray(0, CH), headers: { "upload-offset": 0 } })).data;
check("chunk 1 stored", u.received === CH, u.received);

await cutAfter(u.id, CH, file.subarray(CH, 2 * CH), 1_500_000);
u = (await call("GET", `/api/uploads/${u.id}`)).data;
check("drop mid-chunk: bytes that arrived are kept", u.received > CH && u.received <= CH + 1_500_000, u.received);

const r409 = await call("PUT", `/api/uploads/${u.id}`, { body: file.subarray(0, 10), headers: { "upload-offset": 0 } });
check("wrong offset → 409 with how much is here", r409.status === 409 && r409.data.received === u.received, r409.status);

while (!u.done) u = (await call("PUT", `/api/uploads/${u.id}`, { body: file.subarray(u.received, Math.min(u.received + CH, file.length)), headers: { "upload-offset": u.received } })).data;
const stored = fs.readFileSync(path.join(process.env.DATA_DIR, "parts", u.id));
check("resumed to the end: file is byte-exact", stored.equals(file), stored.length);

const again = (await call("POST", "/api/uploads", { body: { key: "testkey0001", size: file.length } })).data;
check("same file again → already done (no re-upload)", again.id === u.id && again.done, JSON.stringify(again));

const other = (await call("POST", "/api/uploads", { user: "b", body: { key: "testkey0001", size: file.length } })).data;
check("other user, same key → own empty upload", other.id !== u.id && other.received === 0);
check("other user cannot read mine", (await call("GET", `/api/uploads/${u.id}`, { user: "b" })).status === 404);

const over = await call("PUT", `/api/uploads/${other.id}`, { user: "b", body: crypto.randomBytes(file.length + 5), headers: { "upload-offset": 0 } });
check("more than the file size → refused", over.status === 413, over.status);

const target = path.join(process.env.DATA_DIR, "in1.mp4");
takeUpload(db, db.users.a, u.id, target);
check("takeUpload puts the file at the job path", fs.readFileSync(target).equals(file));
let threw = false;
const half = (await call("POST", "/api/uploads", { user: "b", body: { key: "testkey0009", size: 50 } })).data;
try { takeUpload(db, db.users.b, half.id, target + "x"); } catch { threw = true; }
check("takeUpload of an unfinished upload throws", threw);

check("bad key refused", (await call("POST", "/api/uploads", { body: { key: "../x", size: 5 } })).status === 400);
check("too large refused", (await call("POST", "/api/uploads", { body: { key: "testkey0002", size: MAX_UPLOAD + 1 } })).status === 413);
blocked = true;
check("plan allows no reel → upload refused before any bytes", (await call("POST", "/api/uploads", { body: { key: "testkey0003", size: 5 } })).status === 403);

server.close();
console.table(results);
const failed = results.filter((r) => r.ok !== "PASS").length;
console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
