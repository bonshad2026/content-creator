// Private diagnostics. Never pass HTTP request objects, credentials or whole DB/session objects here.
// Trace failures must not interrupt an edit or cause a model request to be retried.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const TRACE_ROOT = path.resolve(process.env.DATA_DIR || 'data', 'edit-traces');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const sensitive = /^(authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access_token|refresh_token|password|sessions)$/i;
const sourceFiles = ['ai.js','edit-analysis.js','edit-routes.js','edit-turn.js','edit-changes.js','template-changes.js','caption-edits.js','template-picture.js','media-evidence.js','media.js','conversation.js','templates.js','template-conversation.js','adjustments.js','template-render.js','jobs.js','edit-trace.js'];
// Captured at module load, not when a later request arrives after source files change.
const sourceHashes = Object.fromEntries(sourceFiles.map(name => {
  try { return [name, digest(fs.readFileSync(fileURLToPath(new URL(name, import.meta.url))))]; }
  catch { return [name, null]; }
}));
const secrets = ['GAPGPT_API_KEY','KAVENEGAR_API_KEY','STAGING_PASSWORD'].map(k => process.env[k]).filter(v => v && v.length >= 8);
const redact = value => secrets.reduce((s, secret) => s.split(secret).join('[REDACTED]'), value);

export function traceError(error) {
  return {name:error?.name || 'Error', message:String(error?.message || error), status:error?.status, code:error?.code};
}

export function createEditTrace({editId, kind, ...metadata}, {root = TRACE_ROOT, resumeId = null, onError = error => console.warn('edit trace unavailable:', error.code || error.name)} = {}) {
  const id = resumeId || randomUUID();
  let dir, sequence = 0, failed = false;
  let started = Date.now();
  const unavailable = error => { if (!failed) { failed = true; try { onError(error); } catch {} } };
  try {
    if (!idPattern.test(editId) || !idPattern.test(id) || !['analysis','render','action'].includes(kind)) throw Error('Invalid trace identity');
    dir = path.join(root, editId, id);
    fs.mkdirSync(path.join(dir, 'blobs'), {recursive:true});
    if (resumeId) {
      const existing = readEditTrace(editId, id, {root});
      sequence = existing.at(-1)?.seq || 0;
      started = Date.parse(existing[0]?.at) || started;
    }
  } catch (error) { unavailable(error); }

  function pack(value) {
    if (typeof value === 'string') {
      const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value);
      if (match) {
        const bytes = Buffer.from(match[2], 'base64'), sha256 = digest(bytes), file = `blobs/${sha256}.bin`;
        if (!fs.existsSync(path.join(dir, file))) fs.writeFileSync(path.join(dir, file), bytes, {mode:0o600});
        return {$traceBlob:{file, sha256, bytes:bytes.length, prefix:value.slice(0, value.indexOf(',') + 1)}};
      }
      return redact(value);
    }
    if (Array.isArray(value)) return value.map(pack);
    if (value instanceof Error) return pack(traceError(value));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? '[REDACTED]' : pack(item)]));
    return value;
  }
  function record(type, data = {}) {
    if (failed) return;
    try {
      const event = {schema:1, traceId:id, seq:++sequence, at:new Date().toISOString(), elapsedMs:Date.now()-started, type, data:pack(data)};
      fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(event) + '\n', {mode:0o600});
    } catch (error) { unavailable(error); }
  }
  async function file(filename) {
    if (failed) return null;
    try {
      const hash = createHash('sha256');
      for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
      return {file:path.basename(filename), bytes:fs.statSync(filename).size, sha256:hash.digest('hex')};
    } catch (error) { record('trace.file_unavailable', {file:path.basename(filename), error:traceError(error)}); return null; }
  }
  record(resumeId ? 'trace.resumed' : 'trace.started', {kind, editId, ...metadata, runtime:{node:process.version, sourceHashes}});
  return {id:failed ? null : id, record, file};
}

// Used only by local offline tooling; this module has no provider/client imports.
export function readEditTrace(editId, traceId, {root = TRACE_ROOT, hydrate = false} = {}) {
  if (!idPattern.test(editId) || !idPattern.test(traceId)) throw Error('Invalid trace identity');
  const dir = path.join(root, editId, traceId);
  function unpack(value) {
    if (value?.$traceBlob) {
      const blob = value.$traceBlob;
      if (!/^blobs\/[a-f0-9]{64}\.bin$/.test(blob.file)) throw Error('Invalid trace blob path');
      const bytes = fs.readFileSync(path.join(dir, blob.file));
      if (digest(bytes) !== blob.sha256 || bytes.length !== blob.bytes) throw Error('Trace blob checksum mismatch');
      return blob.prefix + bytes.toString('base64');
    }
    if (Array.isArray(value)) return value.map(unpack);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,unpack(item)]));
    return value;
  }
  return fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line, index) => {
    const event = JSON.parse(line);
    if (event.schema !== 1 || event.traceId !== traceId || event.seq !== index + 1) throw Error('Invalid trace event sequence');
    return hydrate ? {...event, data:unpack(event.data)} : event;
  });
}

// Diagnostics include private frame copies. Expire them rather than bypassing raw-media retention.
export function pruneEditTraces(now = Date.now(), {root = TRACE_ROOT, days = Number(process.env.TRACE_RETENTION_DAYS || process.env.RAW_RETENTION_DAYS || 7)} = {}) {
  if (!Number.isFinite(days) || days <= 0 || !fs.existsSync(root)) return 0;
  let removed = 0;
  for (const edit of fs.readdirSync(root, {withFileTypes:true})) {
    if (!edit.isDirectory() || !idPattern.test(edit.name)) continue;
    const editDir = path.join(root, edit.name);
    for (const trace of fs.readdirSync(editDir, {withFileTypes:true})) {
      if (!trace.isDirectory() || !idPattern.test(trace.name)) continue;
      const dir = path.resolve(editDir, trace.name), relative = path.relative(path.resolve(root), dir);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
      const events = path.join(dir, 'events.jsonl');
      const modified = fs.statSync(fs.existsSync(events) ? events : dir).mtimeMs;
      if (now - modified < days * 86400000) continue;
      fs.rmSync(dir, {recursive:true, force:true});removed++;
    }
  }
  return removed;
}
