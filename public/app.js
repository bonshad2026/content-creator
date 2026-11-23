// Mobile-first template app. #/create selects a template; #/edit/<id> completes its input contract.
// Media is uploaded resumably. AI receives sampled frames and speech, never the full video.

// ---------------- state & helpers ----------------
const S = { token: null, me: null, jobs: [], config: {}, seen: {}, draft: null, pick: [] };
try { S.token = localStorage.getItem("token"); } catch {}
const $app = document.getElementById("app");
const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fa = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
const go = (h) => (location.hash = h);
// every URL is relative to the page, so the app works under any BASE_URL ("/api/x" → "api/x", "/uploads/y" → "uploads/y")
const rel = (u) => (typeof u === "string" && u.startsWith("/") ? u.slice(1) : u);
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "همین الان" : m < 60 ? `${fa(m)} دقیقه پیش` : m < 1440 ? `${fa(Math.round(m / 60))} ساعت پیش` : new Date(t).toLocaleDateString("fa-IR");
};

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(rel(path), {
    method,
    headers: { "Content-Type": "application/json", ...(S.token ? { "X-Creator-Token": S.token } : {}) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.token) { setToken(null); go("#/login"); }
  if (!res.ok) throw new Error(data.error || "خطا در ارتباط");
  return data;
}
function setToken(t) {
  S.token = t;
  try { t ? localStorage.setItem("token", t) : localStorage.removeItem("token"); } catch {}
}

function toast(text, { type = "", action, onClick, ms = 3500 } = {}) {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.innerHTML = `<span class="t">${esc(text)}</span>${action ? `<span class="a">${esc(action)}</span>` : ""}`;
  el.onclick = () => { el.remove(); onClick && onClick(); };
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), ms);
}

function copyText(text) {
  // navigator.clipboard only works on https/localhost; on the local network (http://192.168…) use the fallback
  const done = () => toast("کپی شد ✓", { type: "ok", ms: 1500 });
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done);
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); done();
}

// ---------------- media → small JPEG frames ----------------
function toJpeg(src, w, h, max, q) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}
function imageFrames(file, max) {
  return new Promise((ok, bad) => {
    const im = new Image();
    im.onload = () => { ok([toJpeg(im, im.naturalWidth, im.naturalHeight, max, 0.8)]); URL.revokeObjectURL(im.src); };
    im.onerror = () => bad(new Error("این عکس باز نشد."));
    im.src = URL.createObjectURL(file);
  });
}
function videoFrames(file, count, max) {
  return new Promise((ok, bad) => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto";
    v.src = URL.createObjectURL(file);
    const fail = () => bad(new Error("این ویدیو در مرورگر باز نشد."));
    v.onerror = fail;
    const timer = setTimeout(fail, 30000);
    v.onloadeddata = async () => {
      const out = [], d = v.duration && isFinite(v.duration) ? v.duration : 1;
      for (let i = 0; i < count; i++) {
        v.currentTime = Math.min(d - 0.05, (d * (i + 0.5)) / count);
        await new Promise((r) => (v.onseeked = r));
        out.push(toJpeg(v, v.videoWidth, v.videoHeight, max, 0.7));
      }
      clearTimeout(timer); URL.revokeObjectURL(v.src); ok(out);
    };
    v.load();
  });
}
// purpose: "post" (new content) or "sample" (style example — fewer, smaller frames)
const fileFrames = (f, purpose) =>
  f.type.startsWith("video/")
    ? videoFrames(f, purpose === "post" ? 4 : 2, 480)
    : imageFrames(f, purpose === "post" ? 768 : 512);

function pickFiles(multiple = true) {
  return new Promise((ok) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = "image/*,video/*"; i.multiple = multiple;
    i.onchange = () => ok([...i.files]);
    i.click();
  });
}

// ---------------- views ----------------
const views = {};

views.login = () => {
  let phone = "";
  const phoneStep = () => {
    $app.innerHTML = `
      <div class="login-hero"><div class="logo">✦</div><h1>محتواساز</h1><p class="muted">قالب انتخاب کن؛ با ویدیوهای خودت بساز</p></div>
      <form id="f" class="stack">
        <input id="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="شماره موبایل  ۰۹۱۲…" class="ltr" required />
        <button class="btn" id="b">دریافت کد</button>
      </form>`;
    const inp = document.getElementById("phone");
    inp.focus();
    document.getElementById("f").onsubmit = async (e) => {
      e.preventDefault();
      busy("b", true);
      try {
        const r = await api("/api/auth/send", { method: "POST", body: { phone: inp.value } });
        phone = r.phone;
        codeStep(r.devCode);
      } catch (err) { toast(err.message, { type: "err" }); busy("b", false); }
    };
  };
  const codeStep = (devCode) => {
    let left = 60;
    $app.innerHTML = `
      <div class="login-hero"><div class="logo">✦</div><h1>کد تأیید</h1><p class="muted">کد ۵ رقمی به ${fa(phone)} پیامک شد</p></div>
      <form id="f" class="stack">
        ${devCode ? `<div class="devcode">پیامک فعال نیست — کد آزمایشی: <b>${fa(devCode)}</b></div>` : ""}
        <input id="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="5" placeholder="- - - - -" class="ltr" required />
        <button class="btn" id="b">ورود</button>
        <div class="center"><button type="button" class="link" id="re" disabled></button> · <button type="button" class="link" id="ch">تغییر شماره</button></div>
      </form>`;
    const code = document.getElementById("code"), re = document.getElementById("re");
    code.focus();
    const tick = () => { re.textContent = left > 0 ? `ارسال دوباره (${fa(left)})` : "ارسال دوباره"; re.disabled = left > 0; };
    tick();
    const t = setInterval(() => { left--; tick(); if (left <= 0 || !document.body.contains(re)) clearInterval(t); }, 1000);
    re.onclick = async () => {
      try { const r = await api("/api/auth/send", { method: "POST", body: { phone } }); clearInterval(t); codeStep(r.devCode); }
      catch (err) { toast(err.message, { type: "err" }); }
    };
    document.getElementById("ch").onclick = () => { clearInterval(t); phoneStep(); };
    code.oninput = () => { if (code.value.replace(/\D|\s/g, "").length >= 5 || /^[۰-۹]{5}$/.test(code.value)) document.getElementById("f").requestSubmit(); };
    document.getElementById("f").onsubmit = async (e) => {
      e.preventDefault();
      busy("b", true);
      try {
        const r = await api("/api/auth/verify", { method: "POST", body: { phone, code: code.value } });
        clearInterval(t);
        setToken(r.token);
        S.me = r.user;
        startPolling();
        go(S.me.name ? "#/home" : "#/name");
      } catch (err) { toast(err.message, { type: "err" }); busy("b", false); code.select(); }
    };
  };
  phoneStep();
};

views.name = () => {
  $app.innerHTML = `
    <div class="login-hero"><div class="logo">👋</div><h1>اسمت چیه؟</h1><p class="muted">که بدونم با کی طرفم</p></div>
    <form id="f" class="stack"><input id="n" placeholder="مثلاً: سارا" maxlength="40" required /><button class="btn" id="b">بزن بریم</button></form>`;
  document.getElementById("n").focus();
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    busy("b", true);
    try { S.me = await api("/api/me", { method: "PUT", body: { name: document.getElementById("n").value } }); go("#/home"); }
    catch (err) { toast(err.message, { type: "err" }); busy("b", false); }
  };
};

views.home = () => {
  const running = S.jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "uploading");
  const recent = S.jobs.filter((j) => j.status === "done" || j.status === "error").slice(0, 3);
  // 1) what is being made now (its own card, so it is never mixed up with "make a new one")
  // 2) the one big button: a new reels (or the saved draft)  3) the latest finished ones
  $app.innerHTML = `
    <div class="hello"><h1>سلام ${esc(S.me.name)} 👋</h1><p class="muted">قالب رو انتخاب کن؛ قدم‌به‌قدم تکمیلش می‌کنیم.</p></div>
    ${planBlocked() ? `<div class="card notice">حسابت هنوز فعال نشده. وقتی مدیر برات پلن فعال کنه، می‌تونی محتوا بسازی.</div>` : ""}
    ${running.length ? `<div class="card making"><div class="making-title"><span class="spinner dark"></span> در حال ساخت (${fa(running.length)})</div>
      ${running.map(jobRow).join("")}
      <p class="muted hint" style="margin:8px 0 0">لازم نیست اینجا بمونی؛ آماده شد خبرت می‌کنم.</p></div>` : ""}
    <div class="big-wrap${running.length ? " compact" : ""}"><button class="big" id="go"><span>＋</span>ساخت ریلز جدید</button></div>
    ${recent.length ? `<div class="section-title">آخرین‌ها <a class="link" href="#/history">همه</a></div>${recent.map(jobRow).join("")}` : ""}`;
  document.getElementById("go").onclick = () => go("#/create");
};

const planBlocked = () => !S.me.admin && S.me.plan && S.me.plan.reelsPerDay === 0 && S.me.plan.postsPerDay === 0;
const limitText = (used, max) => (max == null ? `${fa(used)} (نامحدود)` : `${fa(used)} از ${fa(max)}`);
const faDate = (t) => new Date(t).toLocaleDateString("fa-IR");

const KIND = { video: "ویدیو", carousel: "پست اسلایدی", image: "عکس", reel: "ریلز ویدیویی" };
const STAGE = { analyzing: "بررسی ویدیو…", writing: "نوشتن و برنامه‌ی ادیت…", rendering: "ساخت ویدیو…" };
const statusLabel = (j) => j.status === "running" && STAGE[j.stage] ? STAGE[j.stage] : { uploading: "در حال آپلود", queued: "در صف", running: "در حال تولید…", done: "آماده", error: "خطا" }[j.status];
const thumbOf = (j) => rel(j.coverImg || j.thumb || j.frames?.[0]) || VIDEO_THUMB;

function jobRow(j) {
  const label = statusLabel(j);
  const first = j.output?.caption?.split("\n").find(Boolean) || j.brief || KIND[j.kind];
  const busy = j.status === "queued" || j.status === "running" || j.status === "uploading";
  return `<a class="job${busy ? " busy" : ""}" href="#/job/${j.id}"><img src="${thumbOf(j)}" loading="lazy"><div class="info"><div class="line1">${esc(first)}</div><div class="line2">${busy ? label + " · " : ""}${ago(j.createdAt)}</div>${busy ? '<div class="indet"><i></i></div>' : ""}</div>${busy ? "" : `<span class="status ${j.status}">${label}</span>`}</a>`;
}

// ---------- voice input: a mic button that records, sends the audio, and adds the text to a textarea ----------
// Needs a secure page (HTTPS or localhost) for the microphone; elsewhere the button is not shown.
const canVoice = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
const VOICE_MAX_S = 120;
const MIC_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg>';
const STOP_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>';
const micBtn = (id) => (canVoice() ? `<button type="button" class="mic" data-mic="${id}" title="بگو (ضبط صدا)" aria-label="ضبط صدا">${MIC_SVG}</button>` : "");
/** A textarea with the mic inside it, at its end (like chat apps). */
const voiceArea = (id, attrs, value = "") => `<div class="ta-wrap${canVoice() ? " has-mic" : ""}"><textarea id="${id}" ${attrs}>${esc(value)}</textarea>${micBtn(id)}</div>`;
/** Wire every mic button on the page. onText(textarea) runs after text was added (e.g. save the draft). */
function wireMics(onText = () => {}) {
  document.querySelectorAll("[data-mic]").forEach((btn) => {
    const ta = document.getElementById(btn.dataset.mic);
    let rec = null, timer = null, started = 0;
    const ph = ta.placeholder;
    const idle = () => { ta.placeholder = ph; btn.classList.remove("rec", "busy"); btn.disabled = false; btn.innerHTML = MIC_SVG; };
    const stop = () => { clearInterval(timer); if (rec?.state === "recording") rec.stop(); };
    btn.onclick = async () => {
      if (rec?.state === "recording") return stop();
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch { return toast("اجازه‌ی میکروفون داده نشد. از تنظیمات مرورگر اجازه بده یا تایپ کن.", { type: "err", ms: 6000 }); }
      const type = ["audio/webm", "audio/ogg", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const parts = [];
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(parts, { type: (rec.mimeType || type || "audio/webm").split(";")[0] });
        if (Date.now() - started < 800) return idle(); // a tap, not a recording
        btn.classList.replace("rec", "busy"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; ta.placeholder = "دارم صدات رو به متن تبدیل می‌کنم…";
        try {
          const res = await fetch(rel("/api/voice"), { method: "POST", headers: { "Content-Type": blob.type, "X-Creator-Token": S.token }, body: blob });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "تبدیل صدا ناموفق بود");
          ta.value = (ta.value.trim() ? ta.value.trim() + " " : "") + data.text;
          ta.dispatchEvent(new Event("input"));
          onText(ta);
        } catch (e) { toast(e.message, { type: "err" }); }
        idle();
      };
      rec.start();
      started = Date.now();
      btn.classList.add("rec");
      const tick = () => {
        const sec = Math.floor((Date.now() - started) / 1000);
        btn.innerHTML = `${STOP_SVG}<span dir="ltr">${fa(Math.floor(sec / 60))}:${fa(String(sec % 60).padStart(2, "0"))}</span>`;
        if (sec >= VOICE_MAX_S) stop();
      };
      tick();
      timer = setInterval(tick, 500);
    };
  });
}

const VIDEO_THUMB = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#333"/><path d="M4 3l3 2-3 2z" fill="#fff"/></svg>');
const dataUrlToBlob = (u) => fetch(u).then((r) => r.blob());

// Resumable upload: the file goes in chunks; after a drop it goes on from what the server already has (never from
// zero). The server knows a file by a fingerprint (size + date + a hash of a few sampled pieces), so picking the same
// file again (retry, reload, a failed reel) skips what was sent before, or the whole file.
const CHUNK = 4 * 1024 * 1024;
const STALL_MS = 25000; // no bytes moving for 25s (screen locked, app in background, Wi-Fi drop) → abort and go on
async function fingerprint(blob,ctl) {
  const S1 = 1024 * 1024, n = blob.size;
  const parts = n <= 3 * S1 ? [blob] : [blob.slice(0, S1), blob.slice(Math.floor(n / 2), Math.floor(n / 2) + S1), blob.slice(n - S1)];
  let h1 = 0xdeadbeef ^ n, h2 = 0x41c6ce57 ^ (blob.lastModified || 0);
  for (const p of parts) {
    const b = new Uint8Array(await UploadIO.read(p,ctl));
    for (let i = 0; i < b.length; i++) { h1 = Math.imul(h1 ^ b[i], 2654435761); h2 = Math.imul(h2 ^ b[i], 1597334677); }
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1 >>> 0, h2 >>> 0, n, blob.lastModified || 0].map((v) => v.toString(36)).join("");
}
// cancel: ctl.cancel() stops the chunk in flight and any wait; uploadResumable then throws {cancelled: true}.
// What already reached the server is kept, so picking the same file later goes on from there.
const uploadCtl = () => {
  const c = { cancelled: false, xhr: null, reader: null, wake: null, fail: null };
  c.cancel = () => { c.cancelled = true; c.fail?.(CANCELLED()); c.reader?.abort(); c.xhr?.abort(); c.wake?.(); };
  return c;
};
const CANCELLED = () => Object.assign(new Error("cancelled"), { cancelled: true });
// the phone lost access to the picked file (cloud file not on the phone yet, app long in the background, file moved)
const isUnreadable = (e) => e?.name === "NotReadableError" || e?.name === "NotFoundError" || /could not be read|not readable/i.test(e?.message || "");
function putChunk(id, offset, blob, onProgress, ctl) {
  return new Promise((ok, bad) => {
    const x = new XMLHttpRequest();
    if (ctl) { ctl.xhr = x; ctl.fail = (e) => { clearTimeout(watchdog); bad(e); }; }
    let watchdog;
    const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => { x.abort(); bad(Object.assign(new Error("stalled"), { retry: true })); }, STALL_MS); };
    x.open("PUT", rel("/api/uploads/" + id));
    x.setRequestHeader("X-Creator-Token", S.token);
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.setRequestHeader("Upload-Offset", String(offset));
    x.upload.onprogress = (e) => { arm(); onProgress(e.loaded); };
    x.onload = () => {
      clearTimeout(watchdog);
      let data = {};
      try { data = JSON.parse(x.responseText || "{}"); } catch {}
      if (x.status < 300 || x.status === 409) return ok(data); // 409: out of step → go on from data.received
      bad(Object.assign(new Error(data.error || "آپلود ناموفق بود"), { retry: x.status >= 500 }));
    };
    x.onerror = () => { clearTimeout(watchdog); bad(Object.assign(new Error("network"), { retry: true })); };
    arm();
    x.send(blob);
  });
}
const sleep = (ms, ctl) => new Promise((r) => { const t = setTimeout(r, ms); if (ctl) ctl.wake = () => { clearTimeout(t); r(); }; });
/** → upload id. onProgress(bytes of this file on the server so far), onRetry(n) while the connection is down. */
async function uploadResumable(blob, onProgress, onRetry, ctl = uploadCtl()) {
  const stop = () => { if (ctl.cancelled) throw CANCELLED(); };
  const key = await fingerprint(blob,ctl);
  stop();
  let u = await api("/api/uploads", { method: "POST", body: { key, size: blob.size } });
  stop();
  onProgress(u.received);
  for (let fails = 0; !u.done; ) {
    const from = u.received;
    try {
      u = await putChunk(u.id, from, blob.slice(from, Math.min(from + CHUNK, blob.size)), (l) => onProgress(from + l), ctl);
      stop();
      if (u.received > from) fails = 0;
      onProgress(u.received);
    } catch (e) {
      stop();
      if (!e.retry) throw e;
      await blob.slice(from, from + 1).arrayBuffer(); // a send error can also be the phone losing the file → throws NotReadableError
      if (++fails > 20) throw new Error("آپلود قطع شد. اینترنت رو چک کن و دوباره بزن؛ از همون‌جا که مونده ادامه می‌ده.");
      onRetry?.(fails);
      await sleep(Math.min(1500 * fails, 10000), ctl);
      stop();
      u = await api("/api/uploads/" + u.id).catch(() => u); // how much really arrived
    }
  }
  return u.id;
}

// "۴٫۸" / "۱۲" megabytes (under 10 MB: one decimal; above: whole numbers)
const mb = (b) => { const m = b / 1048576; return fa(m < 10 ? m.toFixed(1) : Math.round(m)).replace(".", "٫"); };

// ---------- draft of the create page ----------
// Everything on the create page (picked files, brief, length, output, mode) is kept in IndexedDB in this phone, so a
// reload, a closed tab or the phone killing the app loses nothing. Files are stored once each (a record per file);
// the small fields go in one record that is rewritten on every change. Cleared when the content is sent or on logout.
// The db name has the page path in it: other apps under the same domain (BASE_URL) have their own.
const DRAFT_DB = "creator-draft:" + location.pathname;
let draftDbP = null;
const draftDb = () => (draftDbP ||= new Promise((ok, bad) => {
  const r = indexedDB.open(DRAFT_DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore("files"); r.result.createObjectStore("kv"); };
  r.onsuccess = () => ok(r.result);
  r.onerror = () => bad(r.error);
}));
async function draftTx(store, mode, fn) {
  const d = await draftDb();
  return new Promise((ok, bad) => {
    const t = d.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => ok(req?.result);
    t.onerror = t.onabort = () => bad(t.error);
  });
}
const quiet = (p) => p.catch((e) => console.warn("draft:", e)); // a draft that can't be saved (private mode, full disk) never blocks the app
const draftSaveFile = (p) => quiet(draftTx("files", "readwrite", (s) => s.put({ file: p.file, kind: p.kind }, p.id)));
const draftDropFile = (id) => quiet(draftTx("files", "readwrite", (s) => s.delete(id)));
let draftTimer;
function draftSaveFields() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => quiet(draftTx("kv", "readwrite", (s) => s.put({
    owner: S.me?.phone, brief: S.brief || "", len: S.len, out: S.out, mode: S.mode,
    pick: S.pick.map((p) => ({ id: p.id, kind: p.kind, frames: p.frames })),
  }, "draft"))), 300);
}
function draftClear() {
  clearTimeout(draftTimer);
  return quiet(Promise.all([draftTx("kv", "readwrite", (s) => s.clear()), draftTx("files", "readwrite", (s) => s.clear())]));
}
/** Put the saved draft back into S (after login is known). Items whose file did not survive are left out. */
async function draftLoad() {
  try {
    const d = await draftTx("kv", "readonly", (s) => s.get("draft"));
    if (!d) return;
    if (d.owner !== S.me?.phone) return draftClear(); // someone else's draft on a shared phone
    const pick = [];
    for (const it of d.pick || []) {
      const f = await draftTx("files", "readonly", (s) => s.get(it.id));
      if (f?.file) pick.push({ id: it.id, kind: it.kind, file: f.file, frames: it.frames || (it.kind === "video" ? [VIDEO_THUMB] : null) });
    }
    Object.assign(S, { pick, brief: d.brief || "", len: d.len, out: d.out, mode: d.mode });
  } catch (e) { console.warn("draft:", e); }
}
const hasDraft = () => S.pick.length > 0 || !!(S.brief || "").trim();

views.history = () => {
  $app.innerHTML = `<h1>محتواهای من</h1><p></p>${S.jobs.length ? S.jobs.map(jobRow).join("") : '<div class="empty">هنوز چیزی نساختی.<br><a class="link" href="#/create">تولید اولین محتوا</a></div>'}`;
};

views.job = (id) => {
  const j = S.jobs.find((x) => x.id === id);
  if (!j) return go("#/history");
  const o = j.output;
  const top = `<div class="topbar"><button class="back" id="bk">→</button><div class="title">${KIND[j.kind]}</div><span class="status ${j.status}">${statusLabel(j)}</span></div>
    ${j.kind === "reel" ? (j.video && j.status === "done" ? `${MediaUI.video(rel(j.video))}
      <div class="dl"><a class="btn" href="${rel(j.video)}" download="reel-${j.id}.mp4">⬇ دانلود ویدیو</a><a class="btn ghost" href="${rel(j.coverImg)}" download="cover-${j.id}.jpg">⬇ کاور</a></div>
      <div class="muted center" style="font-size:.8rem">${RECIPE_FA[j.output?.recipe] ? `قالب ${RECIPE_FA[j.output.recipe]} · ` : ""}${fa(j.output?.duration || 0)} ثانیه${j.output?.subtitles ? " · زیرنویس کلمه‌به‌کلمه" : ""}${j.output?.jumpCuts ? ` · ${fa(j.output.jumpCuts)} جامپ‌کات` : ""}${j.output?.music ? ` · موزیک ${esc(j.output.music.mood)}` : ""}${j.output?.look && j.output.look !== "natural" ? ` · رنگ ${esc(j.output.look)}` : ""}${j.output?.transitions?.length ? ` · ${fa(j.output.transitions.length)} ترنزیشن` : ""}${j.output?.smartCrop ? " · کراپ هوشمند" : ""}${j.output?.colorFixed ? " · اصلاح رنگ" : ""}</div>`: `<div class="strip"><img src="${thumbOf(j)}"></div>`)
      : `<div class="strip">${j.frames.map((f) => `<img src="${rel(f)}">`).join("")}</div>`}`;
  let body;
  if (j.status === "done") {
    const full = `${o.caption}\n\n${(o.hashtags || []).join(" ")}`.trim();
    body = `
      <div class="block"><div class="copy-row"><h3>کپشن</h3><button class="btn small" data-copy="${esc(full)}">کپی</button></div><div class="caption">${esc(o.caption)}</div>${o.hashtags?.length ? `<div class="tags">${esc(o.hashtags.join(" "))}</div>` : ""}</div>
      ${o.narration ? `<div class="block"><div class="copy-row"><h3>متن گفتار ویدیو ${{ persian: "(فارسی)", english: "(انگلیسی)" }[o.narration.language] || (o.narration.language ? `(${esc(o.narration.language)})` : "")}</h3><button class="link" data-copy="${esc(o.narration.text)}">کپی</button></div><div class="caption" style="font-size:.92rem">${esc(o.narration.text)}</div>
        ${o.narration.translation ? `<div class="copy-row" style="margin-top:10px"><h3>ترجمه (زیرنویس ویدیو)</h3><button class="link" data-copy="${esc(o.narration.translation)}">کپی</button></div><div class="caption" style="font-size:.92rem">${esc(o.narration.translation)}</div>` : ""}
        ${o.narration.original && o.narration.original !== o.narration.text ? `<p class="muted" style="font-size:.78rem;margin:8px 0 0">تشخیص خام (قبل از اصلاح): ${esc(o.narration.original)}</p>` : ""}</div>` : ""}
      <div class="block"><h3>شروع‌های دیگه</h3>${(o.hooks || []).map((h) => `<div class="hook"><span>${esc(h)}</span><button class="link" data-copy="${esc(h)}">کپی</button></div>`).join("")}</div>
      ${o.cover ? `<div class="block"><div class="copy-row"><h3>متن کاور</h3><button class="link" data-copy="${esc(o.cover)}">کپی</button></div><b>${esc(o.cover)}</b></div>` : ""}
      ${o.scenes?.length ? `<div class="block"><h3>${j.kind === "reel" ? "متن‌های روی ویدیو" : "سناریوی ویدیو"}</h3>${o.scenes.map((s) => `<div class="scene"><b>${esc(s.t)}</b><span>${esc(s.v)}</span><span class="muted" dir="auto">${esc(s.x)}</span></div>`).join("")}</div>` : ""}
      ${o.tips?.length ? `<div class="block"><h3>نکته</h3><ul style="margin:0;padding-right:18px">${o.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
      ${j.kind === "reel" && j.revisable ? `<div class="block" id="fbk"><h3>نظرت چیه؟</h3>
        <div class="fb"><button class="btn small ${j.feedback?.rating === 1 ? "" : "ghost"}" id="up">👍 خوبه</button><button class="btn small ${j.feedback?.rating === -1 ? "" : "ghost"}" id="down">👎 نه</button></div>
        <p class="muted" style="font-size:.85rem;margin:10px 0 0">چی عوض بشه؟</p>
        ${voiceArea("rv", 'rows="3" maxlength="1000" placeholder="مثلاً: کوتاه‌ترش کن، موزیک نذار، متن اول رو عوض کن، تیکه‌ای که می‌خندم رو اول بذار…"')}
        <button class="btn" id="rvb">✨ دوباره ادیت کن</button>
        <p class="muted" style="font-size:.78rem;margin:6px 0 0">ویدیو دوباره آپلود نمی‌شه؛ فقط یه درخواست کوچیک متنی می‌ره. نظرت برای ریلز‌های بعدی هم یادم می‌مونه.</p></div>` : ""}
      ${j.revise ? `<p class="muted center" style="font-size:.8rem">ادیت دوباره، طبق درخواست: «${esc(j.revise.note)}»</p>` : ""}
      <div class="usage">${j.usage?.tokens ? `مصرف: ${fa(j.usage.tokens.toLocaleString())} توکن${j.usage.note ? ` (${j.usage.note})` : ""}` : ""}</div>
      <button class="btn ghost" id="del" style="margin-top:12px">حذف</button>`;
  } else if (j.status === "error") {
    body = `<div class="block center"><p>${esc(j.error)}</p><button class="btn" id="retry">دوباره تلاش کن</button></div><button class="btn ghost" id="del" style="margin-top:12px">حذف</button>`;
  } else {
    body = `<div class="block center"><span class="spinner dark"></span><p class="muted" style="margin-top:8px">دارم می‌نویسم… می‌تونی بری جاهای دیگه، آماده شد خبرت می‌کنم.</p></div>`;
  }
  $app.innerHTML = `<div class="result">${top}${body}</div>`;
  MediaUI.bind($app);
  document.getElementById("bk").onclick = () => history.length > 1 ? history.back() : go("#/history");
  document.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copyText(b.dataset.copy)));
  const del = document.getElementById("del");
  if (del) del.onclick = async () => { if (!confirm("حذف بشه؟")) return; await api("/api/jobs/" + j.id, { method: "DELETE" }); S.jobs = S.jobs.filter((x) => x !== j); go("#/history"); };
  const retry = document.getElementById("retry");
  if (retry) retry.onclick = async () => { Object.assign(j, await api(`/api/jobs/${j.id}/retry`, { method: "POST" })); S.seen[j.id] = j.status; startPolling(); route(); };
  // feedback + revise
  const rate = async (rating) => {
    try {
      Object.assign(j, await api(`/api/jobs/${j.id}/feedback`, { method: "POST", body: { rating, note: document.getElementById("rv").value } }));
      toast(rating > 0 ? "مرسی! یادم می‌مونه 🙌" : "باشه، بنویس چی عوض بشه و «دوباره ادیت کن» رو بزن.");
      document.getElementById("up").classList.toggle("ghost", rating !== 1);
      document.getElementById("down").classList.toggle("ghost", rating !== -1);
    } catch (err) { toast(err.message, { type: "err" }); }
  };
  const up = document.getElementById("up");
  wireMics();
  if (up) {
    up.onclick = () => rate(1);
    document.getElementById("down").onclick = () => rate(-1);
    document.getElementById("rvb").onclick = async () => {
      const note = document.getElementById("rv").value.trim();
      if (!note) return toast("بنویس چی عوض بشه.", { type: "err" });
      try {
        const nj = await api(`/api/jobs/${j.id}/revise`, { method: "POST", body: { note } });
        S.jobs.unshift(nj);
        S.seen[nj.id] = nj.status;
        startPolling();
        toast("دارم دوباره ادیت می‌کنم… آماده شد خبرت می‌کنم.");
        go("#/job/" + nj.id);
      } catch (err) { toast(err.message, { type: "err" }); }
    };
  }
};

const RECIPE_FA = { "product-presenter": "معرفی محصول", cinematic: "سینمایی", quiz: "کوییز", list: "لیستی", "before-after": "قبل و بعد", tutorial: "آموزشی", story: "داستانی", hook: "مشکل و راه‌حل", promo: "معرفی", talk: "صحبت" };

// ---------------- admin: users ↔ plans, the plans themselves (only for ADMIN_PHONE) ----------------
const LIMIT_FA = { reelsPerDay: "ریلز در روز", reelsPerMonth: "ریلز در ۳۰ روز", postsPerDay: "پست در روز" };
views.admin = async () => {
  if (!S.me.admin) return go("#/settings");
  $app.innerHTML = '<div class="topbar"><button class="back" id="bk">→</button><div class="title">پنل مدیریت</div></div><div id="adm" class="center"><span class="spinner dark"></span></div>';
  document.getElementById("bk").onclick = () => go("#/settings");
  let A;
  try { A = await api("/api/admin"); } catch (err) { return toast(err.message, { type: "err" }); }
  if (!location.hash.startsWith("#/admin")) return;
  const q = (S.adminQ || "").trim();
  const qd = q.replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
  const planName = (id) => A.plans.find((p) => p.id === id)?.name || id;
  const users = A.users.filter((u) => !q || u.phone.includes(qd) || (u.name || "").includes(q));
  const opts = (sel) => `<option value="" ${sel ? "" : "selected"}>پیش‌فرض (${esc(planName(A.defaultPlan))})</option>` +
    A.plans.map((p) => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : "");
  const el = document.getElementById("adm");
  el.className = "";
  el.innerHTML = `
    <div class="section-title">کاربران (${fa(A.users.length)})</div>
    <input id="aq" placeholder="جستجو: شماره یا اسم" value="${esc(q)}">
    ${users.map((u) => `<div class="card admin-user" data-u="${u.id}">
      <div class="row"><span><b>${esc(u.name || "بی‌نام")}</b> <bdi dir="ltr" class="muted">${esc(u.phone)}</bdi>${u.admin ? " · مدیر" : ""}</span><span class="muted">${u.lastAt ? ago(u.lastAt) : "بدون فعالیت"}</span></div>
      ${u.admin ? '<div class="row muted"><span>پلن</span><span>مدیر (بدون محدودیت)</span></div>' : `
      <div class="row"><span>پلن</span><select data-k="plan">${opts(u.plan)}</select></div>
      <div class="row"><span>تا تاریخ (خالی = همیشه)</span><input type="date" data-k="until" value="${day(u.planUntil)}" dir="ltr"></div>
      <div class="row muted"><span>پلن الان</span><span>${esc(planName(u.effective))}</span></div>`}
      <div class="row"><span>یادداشت</span><input data-k="note" value="${esc(u.note)}" placeholder="—"></div>
      <div class="row muted"><span>امروز</span><span>${fa(u.used.reelsToday)} ریل، ${fa(u.used.postsToday)} پست</span></div>
      <div class="row muted"><span>۳۰ روز اخیر</span><span>${fa(u.used.reelsMonth)} ریلز</span></div>
      <div class="row muted"><span>${fa(u.jobs)} کار${u.failed ? ` (${fa(u.failed)} خطا)` : ""}</span><span>${fa(u.tokens.toLocaleString())} توکن</span></div>
    </div>`).join("") || '<div class="empty">کاربری پیدا نشد.</div>'}
    <div class="section-title">پلن‌ها</div>
    <div class="card"><div class="row"><span>پلن کاربرهای جدید</span><select id="dp">${A.plans.map((p) => `<option value="${p.id}" ${p.id === A.defaultPlan ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div></div>
    <p class="muted" style="font-size:.8rem">عدد خالی = نامحدود، ۰ = اجازه نیست.</p>
    ${[...A.plans, { id: "", name: "", reelsPerDay: 2, reelsPerMonth: 20, postsPerDay: 5, isNew: true }].map((p) => `<div class="card admin-plan" data-p="${p.id}">
      ${p.isNew ? '<div class="row"><b>پلن جدید</b></div><div class="row"><span>شناسه (انگلیسی)</span><input data-k="id" dir="ltr" placeholder="vip"></div>'
        : `<div class="row"><b>${esc(p.name)}</b><bdi dir="ltr" class="muted">${p.id}</bdi></div>`}
      <div class="row"><span>اسم</span><input data-k="name" value="${esc(p.name)}"></div>
      ${Object.entries(LIMIT_FA).map(([k, label]) => `<div class="row"><span>${label}</span><input data-k="${k}" type="number" min="0" inputmode="numeric" dir="ltr" placeholder="نامحدود" value="${p[k] ?? ""}"></div>`).join("")}
      <div class="row"><button class="btn small" data-save>${p.isNew ? "افزودن" : "ذخیره"}</button>${p.isNew || p.id === "none" ? "" : '<button class="link" data-del>حذف</button>'}</div>
    </div>`).join("")}`;
  const aq = document.getElementById("aq");
  aq.oninput = () => {
    S.adminQ = aq.value;
    clearTimeout(views.admin.t);
    views.admin.t = setTimeout(() => views.admin().then(() => { const i = document.getElementById("aq"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }), 400);
  };
  const run = async (fn) => {
    try { await fn(); toast("ذخیره شد", { type: "ok", ms: 1500 }); views.admin(); }
    catch (err) { toast(err.message, { type: "err" }); }
  };
  document.querySelectorAll(".admin-user [data-k]").forEach((inp) => (inp.onchange = () =>
    run(() => api("/api/admin/users/" + inp.closest("[data-u]").dataset.u, { method: "PUT", body: { [inp.dataset.k]: inp.value || null } }))));
  document.getElementById("dp").onchange = (e) => run(() => api("/api/admin/settings", { method: "PUT", body: { defaultPlan: e.target.value } }));
  document.querySelectorAll(".admin-plan").forEach((card) => {
    const val = (k) => card.querySelector(`[data-k="${k}"]`)?.value;
    card.querySelector("[data-save]").onclick = () => {
      const id = card.dataset.p || (val("id") || "").trim().toLowerCase();
      const body = { name: val("name"), ...Object.fromEntries(Object.keys(LIMIT_FA).map((k) => [k, val(k) === "" ? null : Number(val(k))])) };
      run(() => api("/api/admin/plans/" + encodeURIComponent(id || "-"), { method: "PUT", body }));
    };
    const del = card.querySelector("[data-del]");
    if (del) del.onclick = () => confirm("این پلن حذف بشه؟ کاربرهایش به پلن پیش‌فرض برمی‌گردند.") &&
      run(() => api("/api/admin/plans/" + card.dataset.p, { method: "DELETE" }));
  });
};

// ---------------- background job polling → toasts ----------------
let pollTimer = null;
async function poll() {
  if (!S.token) return;
  try {
    const jobs = await api("/api/jobs");
    for (const j of jobs) {
      const before = S.seen[j.id];
      if (before && before !== j.status) {
        if (j.status === "done") toast("محتوای جدیدت آماده‌ست ✦", { type: "ok", action: "ببین", onClick: () => go("#/job/" + j.id), ms: 6000 });
        if (j.status === "error") toast("یکی از تولیدها خطا خورد", { type: "err", action: "جزئیات", onClick: () => go("#/job/" + j.id), ms: 6000 });
      }
      S.seen[j.id] = j.status;
    }
    const sig = (list) => JSON.stringify(list.map((j) => j.status + (j.stage || "")));
    const changed = sig(jobs) !== sig(S.jobs) || jobs.length !== S.jobs.length;
    S.jobs = jobs;
    if (changed && /^#\/(home|history|job)/.test(location.hash)) route();
    updateBadge();
  } catch {}
  const busyJobs = S.jobs.some((j) => j.status === "queued" || j.status === "running");
  clearTimeout(pollTimer);
  if (busyJobs) pollTimer = setTimeout(poll, 3000);
}
const startPolling = () => { clearTimeout(pollTimer); pollTimer = setTimeout(poll, 1500); };
document.addEventListener("visibilitychange", () => !document.hidden && S.token && poll());

function updateBadge() {
  const n = S.jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  const a = document.querySelector('#tabbar a[data-tab="home"]');
  a.innerHTML = `<span class="ic">⌂${n ? `<i class="badge">${fa(n)}</i>` : ""}</span>خانه`; // the count sits on the icon corner
}

window.installTemplateFlow({ views, S, $app, api, esc, fa, go, rel, toast, uploadResumable, uploadCtl, draftClear, setToken, startPolling });

// ---------------- router ----------------
function busy(id, on) {
  const b = document.getElementById(id);
  if (!b) return;
  if (on) { b.dataset.t = b.innerHTML; b.innerHTML = '<span class="spinner"></span>'; b.disabled = true; }
  else { b.innerHTML = b.dataset.t || b.innerHTML; b.disabled = false; }
}

function route() {
  const [, name = "home", param] = location.hash.split("/");
  if (!S.token && name !== "login") return go("#/login");
  if (S.token && S.me && !S.me.name && name !== "name") return go("#/name");
  const v = views[name] || views.home;
  const tab = ["home", "history", "settings"].includes(name) || name === "job";
  document.getElementById("tabbar").hidden = !tab;
  document.querySelectorAll("#tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === (name === "job" ? "history" : name)));
  window.scrollTo(0, 0);
  v(param);
}
window.addEventListener("hashchange", route);

(async () => {
  if (S.token) {
    try {
      S.me = await api("/api/me");
      S.jobs = await api("/api/jobs");
      S.jobs.forEach((j) => (S.seen[j.id] = j.status));
      poll();
    } catch { setToken(null); }
  }
  if (!location.hash || location.hash === "#/login" && S.token) location.hash = S.token ? "#/home" : "#/login";
  route();
})();
