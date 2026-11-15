// Mobile-first single-page app (no framework). Hash routes: #/login #/home #/wizard #/create #/history #/job/<id> #/settings
// Videos never get uploaded: the phone grabs a few small frames with <canvas> and only those are sent.

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
    headers: { "Content-Type": "application/json", ...(S.token ? { Authorization: "Bearer " + S.token } : {}) },
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

// ---------------- wizard definition ----------------
const STEPS = [
  { key: "platform", title: "بیشتر کجا محتوا می‌ذاری؟", type: "one", options: ["اینستاگرام", "تیک‌تاک", "یوتیوب شورتز", "تلگرام", "لینکدین", "ایکس (توییتر)"] },
  { key: "niche", title: "محتوات درباره‌ی چیه؟", type: "one", other: true,
    options: ["آشپزی و غذا", "کافه و رستوران", "سفر", "مد و زیبایی", "ورزش و سلامتی", "تکنولوژی", "آموزشی", "کسب‌وکار و فروش", "طنز و سرگرمی", "سبک زندگی"] },
  { key: "tone", title: "لحنت چطوریه؟", sub: "تا ۳ تا انتخاب کن", type: "multi", max: 3,
    options: ["خودمونی", "شوخ و طنز", "صمیمی و آرام", "هیجانی", "الهام‌بخش", "آموزشی", "رسمی", "لاکچری", "رک و بی‌پرده"] },
  { key: "language", title: "به چه زبونی بنویسم؟", type: "one", options: ["فارسی خودمونی", "فارسی رسمی", "انگلیسی", "فارسی + انگلیسی"] },
  { key: "audience", title: "مخاطبت کیه؟", sub: "تا ۳ تا انتخاب کن", type: "multi", max: 3,
    options: ["نوجوان‌ها", "جوان‌ها (۱۸ تا ۳۰)", "۳۰ تا ۴۵ ساله‌ها", "خانم‌ها", "آقایون", "پدر و مادرها", "صاحبان کسب‌وکار", "همه"] },
  { key: "length", title: "کپشن‌ها چقدر باشه؟", type: "one", options: ["کوتاه", "متوسط", "بلند"],
    hints: { "کوتاه": "یکی دو خط", "متوسط": "یه پاراگراف", "بلند": "داستان‌وار" } },
  { key: "emoji", title: "ایموجی بذارم؟", type: "one", options: ["بدون ایموجی", "کم", "زیاد"] },
  { key: "hashtags", title: "هشتگ چی؟", type: "one", options: ["بدون هشتگ", "چندتا (۳ تا ۵)", "زیاد (۱۰+)"] },
  { key: "cta", title: "آخر پست چی بگم؟", type: "one", options: ["یه سؤال از مخاطب", "دعوت به سیو و اشتراک", "دعوت به خرید یا دایرکت", "هیچی"] },
  { key: "samples", title: "چندتا از کارهای قبلیت رو بده", sub: "اختیاریه، ولی سبکت رو دقیق‌تر یاد می‌گیرم", type: "samples" },
];

// ---------------- views ----------------
const views = {};

views.login = () => {
  let phone = "";
  const phoneStep = () => {
    $app.innerHTML = `
      <div class="login-hero"><div class="logo">✦</div><h1>محتواساز</h1><p class="muted">از عکس و ویدیوهات، با سبک خودت، محتوا بساز</p></div>
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
  const running = S.jobs.filter((j) => j.status === "queued" || j.status === "running");
  const recent = S.jobs.filter((j) => j.status === "done" || j.status === "error").slice(0, 3);
  $app.innerHTML = `
    <div class="hello"><h1>سلام ${esc(S.me.name)} 👋</h1><p class="muted">${S.me.style ? "عکس یا ویدیو بده، بقیه‌ش با من." : "اول چندتا سؤال کوتاه می‌پرسم تا سبکت رو بشناسم."}</p></div>
    ${planBlocked() ? `<div class="card notice">حسابت هنوز فعال نشده. وقتی مدیر برات پلن فعال کنه، می‌تونی محتوا بسازی.</div>` : ""}
    <div class="big-wrap"><button class="big" id="go"><span>✦</span>تولید محتوا</button></div>
    ${running.length ? `<div class="section-title">در حال تولید <span class="spinner dark"></span></div>${running.map(jobRow).join("")}` : ""}
    ${recent.length ? `<div class="section-title">آخرین‌ها <a class="link" href="#/history">همه</a></div>${recent.map(jobRow).join("")}` : ""}`;
  document.getElementById("go").onclick = () => go(S.me.style ? "#/create" : "#/wizard");
};

const planBlocked = () => !S.me.admin && S.me.plan && S.me.plan.reelsPerDay === 0 && S.me.plan.postsPerDay === 0;
const limitText = (used, max) => (max == null ? `${fa(used)} (نامحدود)` : `${fa(used)} از ${fa(max)}`);
const faDate = (t) => new Date(t).toLocaleDateString("fa-IR");

const KIND = { video: "ویدیو", carousel: "پست اسلایدی", image: "عکس", reel: "ریل ویدیویی" };
const STAGE = { analyzing: "بررسی ویدیو…", writing: "نوشتن و برنامه‌ی ادیت…", rendering: "ساخت ویدیو…" };
const statusLabel = (j) => j.status === "running" && STAGE[j.stage] ? STAGE[j.stage] : { uploading: "در حال آپلود", queued: "در صف", running: "در حال تولید…", done: "آماده", error: "خطا" }[j.status];
const thumbOf = (j) => rel(j.coverImg || j.thumb || j.frames?.[0]) || VIDEO_THUMB;

function jobRow(j) {
  const label = statusLabel(j);
  const first = j.output?.caption?.split("\n").find(Boolean) || j.brief || KIND[j.kind];
  return `<a class="job" href="#/job/${j.id}"><img src="${thumbOf(j)}" loading="lazy"><div class="info"><div class="line1">${esc(first)}</div><div class="line2">${ago(j.createdAt)}</div></div><span class="status ${j.status}">${label}</span></a>`;
}

views.wizard = (params) => {
  const editing = params === "edit";
  if (!S.draft) S.draft = JSON.parse(JSON.stringify(S.me.style || { tone: [], audience: [], description: "" }));
  let i = 0;
  const d = S.draft;

  const render = () => {
    const st = STEPS[i];
    const pct = Math.round(((i + 1) / STEPS.length) * 100);
    let body = "";
    if (st.type === "one" || st.type === "multi") {
      const sel = st.type === "multi" ? d[st.key] || [] : [d[st.key]];
      const opts = [...st.options];
      if (st.other && d[st.key] && !opts.includes(d[st.key])) opts.push(d[st.key]);
      body = `<div class="chips">${opts.map((o) => `<button class="chip ${sel.includes(o) ? "on" : ""}" data-v="${esc(o)}">${esc(o)}${st.hints?.[o] ? `<small>${st.hints[o]}</small>` : ""}</button>`).join("")}
        ${st.other ? `<button class="chip" data-other="1">سایر…</button>` : ""}</div>`;
    } else {
      body = `
        <div class="picker" id="addS"><div class="ic">🖼️</div><b>انتخاب عکس و ویدیو</b><span class="muted">۳ تا ۶ تا کافیه</span></div>
        <div class="grid" id="sg">${sampleTiles()}</div>
        <h3 style="margin-top:16px">توضیح (اختیاری)</h3>
        <textarea id="desc" rows="3" placeholder="هر چیزی که باید درباره‌ی سبکت بدونم… مثلاً همیشه آخر پست می‌گم «نظرتون؟»">${esc(d.description || "")}</textarea>`;
    }
    const canNext = st.type === "multi" ? (d[st.key] || []).length > 0 : st.type === "samples" || Boolean(d[st.key]);
    $app.innerHTML = `
      <div class="topbar"><button class="back" id="bk">→</button><div class="title">${editing ? "ویرایش سبک" : "سبک تو"}</div><span class="muted">${fa(i + 1)} از ${fa(STEPS.length)}</span></div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <h1>${st.title}</h1>${st.sub ? `<p class="muted">${st.sub}</p>` : "<p></p>"}
      ${body}
      <div class="spacer"></div>
      ${st.type !== "one" || editing ? `<div class="bottom-bar"><button class="btn" id="nx" ${canNext ? "" : "disabled"}>${i === STEPS.length - 1 ? "تموم شد ✓" : "بعدی"}</button></div>` : ""}`;

    document.getElementById("bk").onclick = () => (i > 0 ? (i--, render()) : (S.draft = null, history.back()));
    document.querySelectorAll(".chip[data-v]").forEach((b) => (b.onclick = () => {
      const v = b.dataset.v;
      if (st.type === "one") { d[st.key] = v; render(); if (!editing) setTimeout(next, 180); }
      else {
        const arr = d[st.key] || (d[st.key] = []);
        const k = arr.indexOf(v);
        if (k >= 0) arr.splice(k, 1); else if (arr.length < st.max) arr.push(v); else return toast(`حداکثر ${fa(st.max)} تا`);
        render();
      }
    }));
    const other = document.querySelector("[data-other]");
    if (other) other.onclick = () => { const v = prompt("حوزه‌ی محتوات چیه؟"); if (v && v.trim()) { d[st.key] = v.trim().slice(0, 50); render(); if (!editing) setTimeout(next, 180); } };
    const nx = document.getElementById("nx");
    if (nx) nx.onclick = next;
    if (st.type === "samples") {
      document.getElementById("addS").onclick = addSamples;
      document.getElementById("desc").oninput = (e) => (d.description = e.target.value);
      bindSampleDelete(render);
    }
  };

  const next = async () => {
    if (i < STEPS.length - 1) { i++; return render(); }
    try {
      busy("nx", true);
      S.me = await api("/api/style", { method: "PUT", body: d });
      S.draft = null;
      toast("سبکت ذخیره شد ✓", { type: "ok" });
      go(editing ? "#/settings" : "#/create");
    } catch (err) { toast(err.message, { type: "err" }); busy("nx", false); }
  };

  async function addSamples() {
    const files = await pickFiles(true);
    if (!files.length) return;
    const grid = document.getElementById("sg");
    for (const f of files) {
      const ph = document.createElement("div");
      ph.className = "tile loading";
      grid?.append(ph);
      try {
        const frames = await fileFrames(f, "sample");
        S.me = await api("/api/samples", { method: "POST", body: { kind: f.type.startsWith("video/") ? "video" : "image", frames } });
      } catch (err) { toast(err.message, { type: "err" }); }
    }
    render();
  }
  render();
};

const sampleTiles = () =>
  S.me.samples.map((s) => `<div class="tile"><img src="${rel(s.frames[0])}"><button class="x" data-del="${s.id}">✕</button>${s.kind === "video" ? '<span class="k">ویدیو</span>' : ""}</div>`).join("");
function bindSampleDelete(after) {
  document.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    S.me = await api("/api/samples/" + b.dataset.del, { method: "DELETE" });
    after();
  }));
}

const VIDEO_THUMB = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#333"/><path d="M4 3l3 2-3 2z" fill="#fff"/></svg>');
const dataUrlToBlob = (u) => fetch(u).then((r) => r.blob());

// upload with progress (fetch has no upload progress → XHR)
// If no bytes move for 25s (screen locked, app in background, Wi-Fi drop) the upload is aborted and retried.
const STALL_MS = 25000;
function uploadOnce(url, blob, onProgress) {
  return new Promise((ok, bad) => {
    const x = new XMLHttpRequest();
    let watchdog;
    const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => { x.abort(); bad(Object.assign(new Error("stalled"), { retry: true })); }, STALL_MS); };
    x.open("PUT", rel(url));
    x.setRequestHeader("Authorization", "Bearer " + S.token);
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.upload.onprogress = (e) => { arm(); e.lengthComputable && onProgress(e.loaded); };
    x.onload = () => {
      clearTimeout(watchdog);
      if (x.status < 300) return ok();
      let msg = "آپلود ناموفق بود";
      try { msg = JSON.parse(x.responseText || "{}").error || msg; } catch {}
      bad(Object.assign(new Error(msg), { retry: x.status >= 500 }));
    };
    x.onerror = () => { clearTimeout(watchdog); bad(Object.assign(new Error("network"), { retry: true })); };
    arm();
    x.send(blob);
  });
}
async function uploadFile(url, blob, onProgress, onRetry) {
  for (let attempt = 1; ; attempt++) {
    try { return await uploadOnce(url, blob, onProgress); }
    catch (e) {
      if (!e.retry) throw e;
      if (attempt >= 3) throw new Error("آپلود قطع شد. اینترنت یا وای‌فای رو چک کن، صفحه رو باز نگه دار و دوباره بزن.");
      onRetry?.(attempt);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

views.create = () => {
  if (!S.me.style) return go("#/wizard");
  const P = S.pick; // [{id, file, kind, frames|null}]
  S.mode ||= "separate";
  S.out ||= "reel"; // photos: "reel" (default) or "text"
  S.len ||= "auto"; // reel length: "auto" (the brief / the material decides) or 15 / 30 / 60 s
  let uploading = false;
  const render = () => {
    const hasVideo = P.some((p) => p.kind === "video");
    const asReel = hasVideo || S.out === "reel";
    const ready = P.length && P.every((p) => p.frames) && !uploading;
    const label = asReel ? "✦ ساخت ریل" : `✦ تولید ${P.length > 1 && S.mode === "separate" ? `${fa(P.length)} پست` : ""}`;
    $app.innerHTML = `
      <div class="topbar"><button class="back" id="bk">→</button><div class="title">تولید محتوا</div></div>
      <div class="picker" id="add"><div class="ic">📷</div><b>${P.length ? "افزودن فایل دیگه" : "انتخاب عکس یا ویدیو"}</b><span class="muted">می‌تونی چندتا با هم انتخاب کنی</span></div>
      ${P.length ? `<div class="grid">${P.map((p) => `<div class="tile ${p.frames ? "" : "loading"}">${p.frames ? `<img src="${p.frames[0]}">` : ""}<button class="x" data-rm="${p.id}">✕</button>${p.kind === "video" ? '<span class="k">ویدیو</span>' : ""}</div>`).join("")}</div>` : ""}
      ${P.length && !hasVideo ? `<h3 style="margin-top:16px">خروجی</h3><div class="seg"><button data-o="reel" class="${S.out === "reel" ? "on" : ""}">🎬 ریل ویدیویی</button><button data-o="text" class="${S.out === "text" ? "on" : ""}">📝 فقط متن</button></div>` : ""}
      ${asReel && P.length ? `<p class="muted" style="margin-top:12px">🎬 ${P.length > 1 ? "همه با هم یه ریل می‌شن" : hasVideo ? "ویدیوت ادیت می‌شه" : "عکست ریل می‌شه"}: ${hasVideo ? "بهترین تیکه‌ها، متن فارسی، زیرنویس حرف‌ها" : "حرکت آروم روی عکس، متن فارسی"}، قالب عمودی و کاور.</p>`
        : P.length > 1 ? `<h3 style="margin-top:16px">این ${fa(P.length)} عکس…</h3><div class="seg"><button data-m="separate" class="${S.mode === "separate" ? "on" : ""}">هر کدوم یه پست جدا</button><button data-m="carousel" class="${S.mode === "carousel" ? "on" : ""}">همه با هم یه پست</button></div>` : ""}
      ${asReel && P.length ? `<h3 style="margin-top:16px">طول ریل</h3><div class="seg">${[["auto", "خودکار"], ["15", "۱۵ ثانیه"], ["30", "۳۰ ثانیه"], ["60", "۶۰ ثانیه"]].map(([v, t]) => `<button data-len="${v}" class="${S.len === v ? "on" : ""}">${t}</button>`).join("")}</div>` : ""}
      <h3 style="margin-top:16px">موضوع یا هدف پست (اختیاری)</h3>
      <input id="brief" placeholder="مثلاً: معرفی محصول جدید، فروش بیشتر" value="${esc(S.brief || "")}" />
      <div class="spacer"></div>
      <div class="bottom-bar"><button class="btn" id="gen" ${ready ? "" : "disabled"}>${label}</button></div>`;
    document.getElementById("bk").onclick = () => !uploading && go("#/home");
    document.getElementById("add").onclick = () => !uploading && add();
    document.getElementById("brief").oninput = (e) => (S.brief = e.target.value);
    document.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { if (uploading) return; P.splice(P.findIndex((p) => p.id === b.dataset.rm), 1); render(); }));
    document.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { S.mode = b.dataset.m; render(); }));
    document.querySelectorAll("[data-o]").forEach((b) => (b.onclick = () => { S.out = b.dataset.o; render(); }));
    document.querySelectorAll("[data-len]").forEach((b) => (b.onclick = () => { S.len = b.dataset.len; render(); }));
    document.getElementById("gen").onclick = () => (asReel ? submitReel() : submitPosts());
  };
  const rerender = () => location.hash === "#/create" && !uploading && render();
  async function add() {
    const files = await pickFiles(true);
    for (const f of files) {
      const isVideo = f.type.startsWith("video/");
      const p = { id: Math.random().toString(36).slice(2), kind: isVideo ? "video" : "image", file: f, frames: null };
      P.push(p);
      render();
      // video: only a thumbnail here (the whole file is uploaded and cut on the server); photo: shrink in the phone
      (isVideo ? videoFrames(f, 1, 240).catch(() => [VIDEO_THUMB]) : fileFrames(f, "post"))
        .then((fr) => { p.frames = fr; rerender(); })
        .catch((err) => { toast(err.message, { type: "err" }); P.splice(P.indexOf(p), 1); rerender(); });
    }
  }
  async function submitPosts() {
    const posts = P.length > 1 && S.mode === "carousel" ? [{ kind: "carousel", frames: P.flatMap((p) => p.frames).slice(0, 6) }] : P.map((p) => ({ kind: p.kind, frames: p.frames }));
    busy("gen", true);
    try {
      for (const post of posts) {
        const j = await api("/api/jobs", { method: "POST", body: { ...post, brief: S.brief || "" } });
        S.jobs.unshift(j); S.seen[j.id] = j.status;
      }
      S.pick = []; S.brief = "";
      toast(posts.length > 1 ? `${fa(posts.length)} پست رفت تو صف تولید. آماده شد خبرت می‌کنم.` : "رفت تو صف تولید. آماده شد خبرت می‌کنم.");
      startPolling();
      go("#/home");
    } catch (err) { toast(err.message, { type: "err" }); busy("gen", false); }
  }
  async function submitReel() {
    const btn = document.getElementById("gen");
    uploading = true;
    btn.disabled = true;
    let job = null;
    try {
      btn.innerHTML = '<span class="spinner"></span> آماده‌سازی…';
      const blobs = await Promise.all(P.map(async (p) => (p.kind === "video" ? p.file : dataUrlToBlob((await imageFrames(p.file, 1280))[0]))));
      const totalBytes = blobs.reduce((a, b) => a + b.size, 0);
      job = await api("/api/reels", { method: "POST", body: { brief: S.brief || "", length: S.len === "auto" ? null : +S.len, files: P.map((p) => ({ type: p.kind })) } });
      let done = 0;
      for (let i = 0; i < blobs.length; i++) {
        await uploadFile(
          `/api/reels/${job.id}/files/${i + 1}`, blobs[i],
          (loaded) => { btn.innerHTML = `<span class="spinner"></span> آپلود ${fa(Math.round(((done + loaded) / totalBytes) * 100))}٪ — صفحه رو باز نگه دار`; },
          () => { btn.innerHTML = `<span class="spinner"></span> اتصال قطع شد، دوباره امتحان می‌کنم…`; }
        );
        done += blobs[i].size;
      }
      const j = await api(`/api/reels/${job.id}/start`, { method: "POST" });
      S.jobs.unshift(j); S.seen[j.id] = j.status;
      S.pick = []; S.brief = ""; uploading = false;
      toast("آپلود شد. دارم ادیتش می‌کنم، آماده شد خبرت می‌کنم 🎬");
      startPolling();
      go("#/home");
    } catch (err) {
      uploading = false;
      if (job) api("/api/jobs/" + job.id, { method: "DELETE" }).catch(() => {}); // drop the half-uploaded job
      toast(err.message, { type: "err", ms: 7000 });
      render(); // the picked files stay selected, so one tap tries again
    }
  }
  render();
};

views.history = () => {
  $app.innerHTML = `<h1>محتواهای من</h1><p></p>${S.jobs.length ? S.jobs.map(jobRow).join("") : '<div class="empty">هنوز چیزی نساختی.<br><a class="link" href="#/create">تولید اولین محتوا</a></div>'}`;
};

views.job = (id) => {
  const j = S.jobs.find((x) => x.id === id);
  if (!j) return go("#/history");
  const o = j.output;
  const top = `<div class="topbar"><button class="back" id="bk">→</button><div class="title">${KIND[j.kind]}</div><span class="status ${j.status}">${statusLabel(j)}</span></div>
    ${j.kind === "reel" ? (j.video && j.status === "done" ? `<video class="reel" src="${rel(j.video)}" poster="${rel(j.coverImg)}" controls playsinline preload="metadata"></video>
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
        <textarea id="rv" rows="2" placeholder="چی عوض بشه؟ مثلاً: کوتاه‌ترش کن، موزیک نذار، متن اول رو عوض کن"></textarea>
        <button class="btn" id="rvb">✨ دوباره ادیت کن</button>
        <p class="muted" style="font-size:.78rem;margin:6px 0 0">ویدیو دوباره آپلود نمی‌شه؛ فقط یه درخواست کوچیک متنی می‌ره. نظرت برای ریل‌های بعدی هم یادم می‌مونه.</p></div>` : ""}
      ${j.revise ? `<p class="muted center" style="font-size:.8rem">ادیت دوباره، طبق درخواست: «${esc(j.revise.note)}»</p>` : ""}
      <div class="usage">${j.usage?.tokens ? `مصرف: ${fa(j.usage.tokens.toLocaleString())} توکن${j.usage.note ? ` (${j.usage.note})` : ""}` : ""}</div>
      <button class="btn ghost" id="del" style="margin-top:12px">حذف</button>`;
  } else if (j.status === "error") {
    body = `<div class="block center"><p>${esc(j.error)}</p><button class="btn" id="retry">دوباره تلاش کن</button></div><button class="btn ghost" id="del" style="margin-top:12px">حذف</button>`;
  } else {
    body = `<div class="block center"><span class="spinner dark"></span><p class="muted" style="margin-top:8px">دارم می‌نویسم… می‌تونی بری جاهای دیگه، آماده شد خبرت می‌کنم.</p></div>`;
  }
  $app.innerHTML = `<div class="result">${top}${body}</div>`;
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

// logo → PNG (keeps transparency), max 512 px
function toPng(file, max = 512) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
const RECIPE_FA = { cinematic: "سینمایی", quiz: "کوییز", list: "لیستی", "before-after": "قبل و بعد", tutorial: "آموزشی", story: "داستانی", hook: "مشکل و راه‌حل", promo: "معرفی", talk: "صحبت" };
const BRAND_COLORS = ["#FFD400", "#FF3B6B", "#00D1FF", "#7CFF4F", "#B266FF", "#FF8A00", "#FFFFFF"];

views.settings = (fresh) => {
  if (fresh !== true) api("/api/me").then((me) => { S.me = me; if (location.hash.startsWith("#/settings")) views.settings(true); }).catch(() => {});
  const st = S.me.style;
  const u = S.me.usage || { tokens: 0 };
  $app.innerHTML = `
    <h1>تنظیمات</h1><p></p>
    <div class="card">
      <div class="row"><span>اسم</span><button class="link" id="nm">${esc(S.me.name)} ✎</button></div>
      <div class="row"><span>موبایل</span><span class="v">${fa(S.me.phone)}</span></div>
    </div>
    <div class="section-title">سبک من <button class="btn small" id="edit">ویرایش</button></div>
    <div class="card">${st ? [
      ["پلتفرم", st.platform], ["حوزه", st.niche], ["لحن", st.tone.join("، ")], ["زبان", st.language], ["مخاطب", st.audience.join("، ")],
      ["طول کپشن", st.length], ["ایموجی", st.emoji], ["هشتگ", st.hashtags], ["پایان پست", st.cta], ["توضیح", st.description || "—"],
    ].map(([k, v]) => `<div class="row"><span>${k}</span><span class="v">${esc(v)}</span></div>`).join("") : '<div class="empty">هنوز سبکی تعریف نکردی.</div>'}</div>
    <div class="section-title">برند من</div>
    <div class="card" id="brand">
      <div class="row"><span>رنگ اصلی</span><div class="swatches">${BRAND_COLORS.map((c) => `<button class="sw ${(S.me.brand?.color || "#FFD400").toUpperCase() === c ? "on" : ""}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div></div>
      <div class="row"><span>آیدی پیج</span><button class="link" id="hd">${S.me.brand?.handle ? `<bdi dir="ltr">${esc(S.me.brand.handle)}</bdi>` : "تنظیم نشده"} ✎</button></div>
      <div class="row"><span>لوگو</span><span class="logo-row">${S.me.brand?.logo ? `<img src="${rel(S.me.brand.logo)}" class="logo" alt="">` : ""}<button class="link" id="lg">${S.me.brand?.logo ? "عوض کن" : "آپلود"}</button></span></div>
      <label class="row"><span>کارت پایانی (لوگو، آیدی، دعوت به فالو)</span><input type="checkbox" id="ou" ${S.me.brand?.outro ? "checked" : ""}></label>
      <label class="row"><span>لوگوی کوچیک گوشه‌ی ویدیو</span><input type="checkbox" id="wm" ${S.me.brand?.watermark ? "checked" : ""}></label>
    </div>
    <div class="section-title">نمونه‌کارها <button class="btn small" id="addS">افزودن</button></div>
    <div class="grid" id="sg">${sampleTiles() || '<p class="muted">نمونه‌کاری نیست.</p>'}</div>
    <div class="section-title">پلن و مصرف</div>
    <div class="card">${S.me.admin ? '<div class="row"><span>پلن</span><span class="v">مدیر (بدون محدودیت)</span></div>' : S.me.plan ? `
      <div class="row"><span>پلن</span><span class="v">${esc(S.me.plan.name)}${S.me.plan.until ? ` · تا ${faDate(S.me.plan.until)}` : ""}</span></div>
      <div class="row"><span>ریل امروز</span><span class="v">${limitText(S.me.plan.used.reelsToday, S.me.plan.reelsPerDay)}</span></div>
      <div class="row"><span>ریل ۳۰ روز اخیر</span><span class="v">${limitText(S.me.plan.used.reelsMonth, S.me.plan.reelsPerMonth)}</span></div>
      <div class="row"><span>پست امروز</span><span class="v">${limitText(S.me.plan.used.postsToday, S.me.plan.postsPerDay)}</span></div>` : ""}
      <div class="row"><span>کل توکن مصرف‌شده</span><span class="v">${fa((u.tokens || 0).toLocaleString())}</span></div></div>
    ${S.me.admin ? '<a class="btn" href="#/admin" style="margin-top:16px">پنل مدیریت</a>' : ""}
    <button class="btn ghost" id="out" style="margin-top:20px">خروج از حساب</button>`;
  document.getElementById("edit").onclick = () => { S.draft = null; go("#/wizard/edit"); };
  document.getElementById("nm").onclick = async () => {
    const n = prompt("اسمت:", S.me.name);
    if (n && n.trim()) { S.me = await api("/api/me", { method: "PUT", body: { name: n } }); views.settings(); }
  };
  document.getElementById("addS").onclick = async () => {
    for (const f of await pickFiles(true)) {
      try { S.me = await api("/api/samples", { method: "POST", body: { kind: f.type.startsWith("video/") ? "video" : "image", frames: await fileFrames(f, "sample") } }); views.settings(); }
      catch (err) { toast(err.message, { type: "err" }); }
    }
  };
  bindSampleDelete(views.settings);
  // brand kit
  const saveBrand = async (patch) => {
    const b = { color: "#FFD400", handle: "", outro: false, watermark: false, ...(S.me.brand || {}), ...patch };
    try { S.me = await api("/api/brand", { method: "PUT", body: b }); views.settings(); toast("ذخیره شد"); }
    catch (err) { toast(err.message, { type: "err" }); }
  };
  document.querySelectorAll(".sw").forEach((b) => (b.onclick = () => saveBrand({ color: b.dataset.c })));
  document.getElementById("hd").onclick = () => {
    const h = prompt("آیدی پیجت (مثلاً ‎@mypage):", S.me.brand?.handle || "");
    if (h !== null) saveBrand({ handle: h.trim() });
  };
  document.getElementById("ou").onchange = (e) => saveBrand({ outro: e.target.checked });
  document.getElementById("wm").onchange = (e) => saveBrand({ watermark: e.target.checked });
  document.getElementById("lg").onclick = async () => {
    const [f] = await pickFiles(false);
    if (!f) return;
    try { S.me = await api("/api/brand/logo", { method: "POST", body: { dataUrl: await toPng(f) } }); views.settings(); toast("لوگو ذخیره شد"); }
    catch (err) { toast(err.message, { type: "err" }); }
  };
  document.getElementById("out").onclick = async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); setToken(null); S.me = null; S.jobs = []; go("#/login"); };
};

// ---------------- admin: users ↔ plans, the plans themselves (only for ADMIN_PHONE) ----------------
const LIMIT_FA = { reelsPerDay: "ریل در روز", reelsPerMonth: "ریل در ۳۰ روز", postsPerDay: "پست در روز" };
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
      <div class="row muted"><span>۳۰ روز اخیر</span><span>${fa(u.used.reelsMonth)} ریل</span></div>
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
  a.innerHTML = `<span>⌂</span>خانه${n ? ` <i class="badge">${fa(n)}</i>` : ""}`;
}

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
