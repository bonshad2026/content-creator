// Template-first creation. Recording is local until the explicit Send action.
window.installTemplateFlow = ({ views, S, $app, api, esc, fa, go, rel, toast, uploadResumable, uploadCtl, draftClear, setToken, startPolling }) => {
  let timer, stream, recorder, recordTimer, pending = [], urls = [], currentId, sending = false, activeUpload, preparation, liveWaveStop, discardRecording=false,writableDraft=false, snapshotSignature="",draftFields={text:"",part:""};
  const signature=e=>JSON.stringify([e.id,e.status,e.error,e.messages,e.selection,e.segments,e.requirements,e.jobId]);
  const $ = id => document.getElementById(id);
  const release = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; };
  const stopTracks = () => {liveWaveStop?.();liveWaveStop=null;stream?.getTracks().forEach(t => t.stop()); stream = null; clearTimeout(recordTimer); };
  const stopRecording = () => { if (recorder?.state === "recording") recorder.stop(); stopTracks(); };
  const leave = () => { clearTimeout(timer); activeUpload?.cancel(); preparation?.abort(); activeUpload=null; sending=false; stopRecording(); release();$app.classList.remove("chat-page");document.body.classList.remove("chat-mode"); };
  const viewport=()=>{document.documentElement.style.setProperty("--chat-height",`${window.visualViewport?.height||innerHeight}px`);document.documentElement.style.setProperty("--chat-top",`${window.visualViewport?.offsetTop||0}px`);};
  window.visualViewport?.addEventListener("resize",viewport);window.visualViewport?.addEventListener("scroll",viewport);window.addEventListener("resize",viewport);viewport();
  window.addEventListener("hashchange", leave);
  window.addEventListener("beforeunload", e => { if (pending.length || sending || recorder?.state === "recording") { e.preventDefault(); e.returnValue = ""; } });
  const mediaUrl = blob => { const u = URL.createObjectURL(blob); urls.push(u); return u; };
  const request = async (path, options) => { try { return await api(path, options); } catch(e) { toast(e.message,{type:"err"}); throw e; } };
  const top = title => `<div class="topbar"><a class="back" href="#/home" aria-label="خانه">→</a><h1>${title}</h1></div>`;
  const hasCapture = () => !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${{
    mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/>',
    video:'<rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 9 6-3v12l-6-3"/>',
    folder:'<path d="M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v2M3 7h5l2 3h11a1 1 0 0 1 1 1.2l-2 8a2 2 0 0 1-2 1.8H5a2 2 0 0 1-2-2V7Z"/>'
    ,clip:'<path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9a2 2 0 0 1 3 3l-9 9a1 1 0 0 0 2 2l8-8"/>'
  }[name]}</svg>`;
  const saveDraft=async()=>{
    if(!S.me||!currentId||!writableDraft)return;
    await ChatDraft.save(S.me.phone,{editId:currentId,...draftFields,pending:pending.map(p=>({id:p.id,type:p.type,prepared:!!p.originalFile,name:p.file.name,peaks:p.peaks||null}))});
  };
  const draftError=()=>toast("گوشی نتونست پیش‌نویس رو ذخیره کنه؛ فعلاً صفحه رو نبند.",{type:"err",ms:7000});
  const oldHome=views.home;
  views.home=()=>{oldHome();api("/api/edits").then(edits=>{if(location.hash!=="#/home")return;const active=edits.find(e=>!e.jobId&&!e.archived);if(active){const b=$("go");b.textContent="ادامهٔ ادیت";b.onclick=()=>go(`#/edit/${active.id}`);}}).catch(()=>{});};

  views.create = async () => {
    leave(); $app.innerHTML = top("انتخاب قالب") + '<p class="muted">قالب رو انتخاب کن؛ بعد فایل‌هات رو بفرست.</p>';
    try {
      const [templates, edits] = await Promise.all([api("/api/templates"), api("/api/edits")]);
      if (location.hash !== "#/create") return;
      $app.innerHTML = top("انتخاب قالب") + templates.map(t => `<article class="card template-card">
        ${t.sample ? MediaUI.video(t.sample) : '<div class="template-story" aria-label="ساختار قالب"><span>چهره</span><i>←</i><span>محصولات</span><i>←</i><span>جمع‌بندی</span></div><p class="muted">پیش‌نمایش ساختار؛ نمونهٔ ویدیویی هنوز اضافه نشده.</p>'}
        <h2>${esc(t.name)}</h2><p>${esc(t.description)}</p><p class="muted">یک یا چند ویدیو؛ تکمیل با صوت و تصویر.</p><button class="btn" data-template="${esc(t.id)}">این قالب رو می‌خوام</button></article>`).join("") +
        (edits.length ? '<h2>گفت‌وگوهای من</h2>' + edits.map(e=>`<a class="card edit-link" href="#/edit/${e.id}"><b>معرفی محصول</b><span>${e.jobId ? "دیدن خروجی" : e.status === "analyzing" ? "در حال بررسی" : "ادامهٔ گفت‌وگو"}</span></a>`).join("") : "");
      document.querySelectorAll("[data-template]").forEach(b=>b.onclick=async()=>{
        b.disabled=true;
        try { const e=await request("/api/edits",{method:"POST",body:{templateId:b.dataset.template}}); go(`#/edit/${e.id}`); }
        catch { b.disabled=false; }
      });
      MediaUI.bind($app);
    } catch(e) { toast(e.message,{type:"err"}); }
  };
  // Old bookmarks lead into templates; the style questionnaire has been removed.
  views.wizard = () => go("#/create");

  views.edit = async id => {
    clearTimeout(timer);
    if (currentId !== id) { pending=[]; draftFields={text:"",part:""};release(); currentId=id; }
    $app.innerHTML=top("معرفی محصول")+'<p class="muted">در حال دریافت گفت‌وگو…</p>';
    try { const [e,config]=await Promise.all([api(`/api/edits/${id}`),api("/api/config")]);S.config=config;
      try{const d=await ChatDraft.load(S.me.phone,id);if(d){pending=d.pending;draftFields={text:d.text||"",part:d.part||"",transcriptEdits:d.transcriptEdits||{}};if(d.missing)toast("بعضی فایل‌های پیش‌نویس از حافظهٔ گوشی پاک شده‌اند.",{type:"err"});}}catch{draftError();}
      if(location.hash===`#/edit/${id}`) showChat(e); }
    catch(e) { toast(e.message,{type:"err"}); }
  };

  function showChat(e) {
    const oldScroll=$("chat-scroll"),oldTop=oldScroll?.scrollTop||0,atBottom=!oldScroll||oldScroll.scrollHeight-oldTop-oldScroll.clientHeight<80;
    const focused=document.activeElement?.id==="edit-text", selection=focused?[$("edit-text").selectionStart,$("edit-text").selectionEnd]:null;
    const playing=[...document.querySelectorAll(".bubble-media video,.bubble-media audio")].map(m=>({src:m.getAttribute("src"),time:m.currentTime,paused:m.paused}));
    snapshotSignature=signature(e);
    release();
    $app.classList.add("chat-page");document.body.classList.add("chat-mode");viewport();
    const locked=e.status==="analyzing" || !!e.jobId || e.archived, missing=e.requirements.filter(r=>!r.done);
    writableDraft=!e.jobId&&!e.archived;
    const expected = [...e.messages].reverse().find(m=>m.role==="assistant"&&m.part)?.part;
    let activePart = draftFields.part || (e.assets.length && missing.some(r=>r.id===expected&&r.accepts!=="confirm") ? expected : "");
    let draft=draftFields.text;
    const chosen = new Set([...(e.selection?.opening||[]),...(e.selection?.closing||[]),...(e.selection?.products||[]).flatMap(p=>p.speech)]);
    $app.innerHTML=`<div class="chat-shell"><header class="chat-header"><a class="back" href="#/home" aria-label="خانه">→</a><div><h1>معرفی محصول</h1><small>${e.archived?"گفت‌وگوی بایگانی‌شده":e.jobId?"ادیت ارسال‌شده":"پیش‌نویس · خودکار ذخیره می‌شود"}</small></div>${!e.jobId&&!e.archived?'<button class="discard-open" id="discard-open" aria-label="کنار گذاشتن پیش‌نویس">⋯</button>':""}
      <details class="requirements"><summary>${fa(missing.length)} بخش مانده</summary><div class="parts-popover">
      ${e.requirements.map(r=>`<button class="requirement" data-part="${esc(r.id)}" ${locked||r.done?"disabled":""}><span>${r.done?"✓":"○"} ${esc(r.label)}</span><small>${r.done?"آماده":"تکمیل"}</small></button>`).join("")}</div></details>
      </header><div class="chat-messages" id="chat-scroll">
      ${e.demo?'<div class="chat-system-note">حالت نمایشی؛ تحلیل محتوا غیرفعال است.</div>':""}
      <div class="chat-log" role="log" aria-live="polite">${e.messages.filter(m=>e.demo||m.role!=="assistant"||!/حالت نمایشی|محتوای گفتار بررسی نشده/.test(m.text||"")).map(m=>`<div class="chat-bubble ${m.role}">${m.part?`<small>${esc(m.label||e.requirements.find(r=>r.id===m.part)?.label||"")}</small>`:""}${m.text?`<p>${esc(m.text)}</p>`:""}${(m.assetIds||[]).map(id=>{
        const a=e.assets.find(a=>a.id===id),src=a?rel(`/api/edits/${e.id}/assets/${a.id}`):""; return a?`<div class="bubble-media">${a.type==="audio"?MediaUI.audio(src,{peaks:a.waveform}):MediaUI.video(src)}<small>${esc(a.type==="audio"?"پیام صوتی":a.name)}</small></div>`:"";
      }).join("")}</div>`).join("")}${e.status==="analyzing"?'<div class="chat-bubble assistant typing-indicator" role="status" aria-label="در حال بررسی"><i></i><i></i><i></i></div>':""}</div>
      <div id="attachment-player"></div>
      ${e.segments.length?`<details class="card transcript-panel" id="transcript-panel" ${missing.some(r=>r.id==="transcript-review")?"open":""}><summary>متن گفتار · دیدن و اصلاح</summary><p class="muted">متن تشخیص‌داده‌شده ممکنه اشتباه باشه؛ قبل از ساخت بررسیش کن.</p>${e.segments.map(s=>{const correction=e.selection?.corrections?.find(c=>c.id===s.id);return `<label class="transcript-line"><span>${fa(s.start.toFixed(1))}–${fa(s.end.toFixed(1))} ثانیه${correction?" · پیشنهاد اصلاح":""}</span><textarea data-transcript="${esc(s.id)}" rows="2" maxlength="600" ${locked?"disabled":""}>${esc(draftFields.transcriptEdits?.[s.id]??correction?.text??s.text)}</textarea></label>`;}).join("")}${!locked?'<button class="btn" id="save-transcript">ذخیرهٔ متن و بررسی دوباره</button>':""}</details>`:""}
      ${e.selection&&chosen.size ? `<details class="card"><summary>بخش‌های انتخاب‌شده</summary>${e.segments.filter(s=>chosen.has(s.id)).map(s=>`<p class="selected-speech"><small>${fa(s.start.toFixed(1))}–${fa(s.end.toFixed(1))} ثانیه</small>${esc(s.text)}</p>`).join("")}
      <div class="evidence-frames">${[...new Set(e.selection.products.flatMap(p=>p.visuals))].map(id=>`<img data-frame="${esc(id)}" alt="نمای انتخاب‌شدهٔ محصول">`).join("")}</div></details>`:""}
      ${e.error?`<div class="card notice">${esc(e.error)}<button class="btn" id="edit-retry">بررسی دوباره</button></div>`:""}
      ${!locked&&e.analysis!==null&&e.selection&&!missing.length ? `<button class="btn" id="edit-build">ساخت ویدیو</button>`:""}
      ${missing.some(r=>r.id==="confirm")&&!locked?'<button class="btn ghost" id="edit-confirm">تشخیص محصولات درست است</button>':""}
      ${e.jobId?`<a class="btn" href="#/job/${e.jobId}">دیدن وضعیت و خروجی</a>`:""}
      </div>${e.jobId||e.archived?"":`<section class="chat-composer">
        <div id="reply-context" class="reply-context" hidden><span id="reply-label"></span><button type="button" class="link" id="reply-clear" aria-label="ارسال بدون انتخاب بخش" ${locked?"disabled":""}>×</button></div>
        <p class="muted" id="part-prompt" hidden></p>
        <div id="record-stage" aria-live="polite"></div><div id="pending-media"></div><p id="send-progress" aria-live="polite"></p>
        <div class="compose-line"><button id="attach-open" class="attach-button" aria-label="پیوست" aria-haspopup="dialog" ${locked?"disabled":""}>${icon("clip")}</button><textarea id="edit-text" rows="1" maxlength="1000" placeholder="پیام…" ${locked?"disabled":""}>${esc(draft)}</textarea><button id="edit-send" class="btn send-button" aria-label="ارسال و بررسی" ${locked?"disabled":""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m21 3-7 18-4-7-7-4 18-7Z"/><path d="m10 14 5-5"/></svg></button></div>
        <button id="cancel-send" class="btn ghost" hidden>لغو آپلود</button>
      </section><div class="attachment-overlay" id="attachment-drawer" hidden><button class="drawer-backdrop" id="drawer-backdrop" aria-label="بستن پیوست‌ها"></button><section class="attachment-sheet" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div class="drawer-handle"></div><div class="drawer-title"><b id="drawer-title">افزودن به گفت‌وگو</b><button class="link" id="drawer-close" aria-label="بستن">×</button></div><div class="drawer-actions"><button id="edit-audio" class="drawer-action" ${locked?"disabled":""}><span class="action-icon">${icon("mic")}</span><span>ضبط صدا</span></button><button id="edit-video" class="drawer-action" ${locked?"disabled":""}><span class="action-icon">${icon("video")}</span><span>ضبط ویدیو</span></button><button id="edit-files" class="drawer-action" ${locked?"disabled":""}><span class="action-icon">${icon("folder")}</span><span>انتخاب فایل</span></button></div><p>راحت ضبط کن؛ قبل از ارسال پخشش کن.</p></section></div>`}
      ${!e.jobId&&!e.archived?'<div class="discard-overlay" id="discard-modal" hidden><div class="modal-shade"></div><section role="alertdialog" aria-modal="true" aria-labelledby="discard-title" class="discard-dialog"><h2 id="discard-title">این پیش‌نویس کنار گذاشته بشه؟</h2><p>متن و فایل‌های ارسال‌نشده از پیش‌نویس پاک می‌شن.</p><div><button class="btn ghost" id="discard-cancel">انصراف</button><button class="btn danger" id="discard-confirm">کنار گذاشتن</button></div><p class="discard-error" id="discard-error"></p></section></div>':""}</div>`;
    MediaUI.bind($app);
    if($("discard-open")){
      const close=()=>{$("discard-modal").hidden=true;$("discard-open").focus();};
      $("discard-open").onclick=()=>{$("discard-modal").hidden=false;$("discard-cancel").focus();};$("discard-cancel").onclick=close;
      $("discard-modal").onkeydown=event=>{if(event.key==="Escape")close();if(event.key==="Tab"){event.preventDefault();(document.activeElement===$("discard-cancel")?$("discard-confirm"):$("discard-cancel")).focus();}};
      $("discard-confirm").onclick=async()=>{const button=$("discard-confirm");button.disabled=true;try{await api(`/api/edits/${e.id}/discard`,{method:"POST",body:{confirm:true}});discardRecording=true;stopRecording();preparation?.abort();activeUpload?.cancel();pending=[];draftFields={text:"",part:""};writableDraft=false;await ChatDraft.clear(S.me.phone).catch(draftError);currentId=null;go("#/create");}catch(err){$("discard-error").textContent=err.message;button.disabled=false;}};
    }
    const scroll=$("chat-scroll");scroll.scrollTop=atBottom?scroll.scrollHeight:oldTop;
    if(focused&&$("edit-text")){$("edit-text").focus({preventScroll:true});$("edit-text").setSelectionRange(...selection);}
    document.querySelectorAll(".bubble-media video,.bubble-media audio").forEach(media=>{const old=playing.find(p=>p.src===media.getAttribute("src"));if(old&&old.time>0)media.addEventListener("loadedmetadata",()=>{media.currentTime=old.time;if(!old.paused)media.play().catch(()=>{});},{once:true});});
    $("edit-text")?.addEventListener("input",()=>{draftFields.text=$("edit-text").value;saveDraft().catch(draftError);$("edit-text").style.height="auto";$("edit-text").style.height=Math.min(120,$("edit-text").scrollHeight)+"px";});
    const setContext = part => {
      activePart=part;
      draftFields.part=part;saveDraft().catch(draftError);
      const r=e.requirements.find(r=>r.id===part);
      if(!$("reply-context"))return;
      $("reply-context").hidden=!r;
      $("reply-label").textContent=r?`پاسخ به: ${r.label}`:"";
      $("part-prompt").textContent=r?.prompt||"";$("part-prompt").hidden=!r;
    };
    setContext(activePart);
    if($("reply-clear"))$("reply-clear").onclick=()=>setContext("");
    document.querySelectorAll("[data-transcript]").forEach(input=>input.oninput=()=>{(draftFields.transcriptEdits||={})[input.dataset.transcript]=input.value;saveDraft().catch(draftError);});
    if($("save-transcript"))$("save-transcript").onclick=async()=>{const button=$("save-transcript");button.disabled=true;try{const segments=[...document.querySelectorAll("[data-transcript]")].map(input=>({id:input.dataset.transcript,text:input.value}));const next=await request(`/api/edits/${e.id}/transcript`,{method:"POST",body:{segments}});draftFields.transcriptEdits={};await saveDraft().catch(draftError);showChat(next);}catch{button.disabled=false;}};
    document.querySelectorAll("[data-part]").forEach(b=>b.onclick=()=>{if(b.dataset.part==="confirm")return;document.querySelector(".requirements").open=false;if(b.dataset.part==="transcript-review"){$("transcript-panel").open=true;$("transcript-panel").scrollIntoView({block:"start",behavior:"smooth"});return;}setContext(b.dataset.part);$("edit-text")?.focus();});
    const refresh=async()=>{try{const next=await api(`/api/edits/${e.id}`);if(location.hash!==`#/edit/${e.id}`)return;if(signature(next)===snapshotSignature){if(next.status==="analyzing")timer=setTimeout(refresh,1800);return;}showChat(next);}catch{if(location.hash===`#/edit/${e.id}`)timer=setTimeout(refresh,5000);}};
    if(e.status==="analyzing")timer=setTimeout(refresh,1800);
    if($("edit-retry"))$("edit-retry").onclick=async()=>{try{showChat(await request(`/api/edits/${e.id}/analyze`,{method:"POST"}));}catch{}};
    if($("edit-confirm"))$("edit-confirm").onclick=async()=>{try{showChat(await request(`/api/edits/${e.id}/confirm`,{method:"POST"}));}catch{}};
    if($("edit-build"))$("edit-build").onclick=async()=>{
      $("edit-build").disabled=true;
      try{const next=await request(`/api/edits/${e.id}/render`,{method:"POST"});await ChatDraft.clear(S.me.phone);S.jobs=await api("/api/jobs");startPolling();go(`#/job/${next.jobId}`);}catch{$("edit-build").disabled=false;}
    };
    document.querySelectorAll("[data-frame]").forEach(async im=>{
      try{const r=await fetch(rel(`/api/edits/${e.id}/frames/${encodeURIComponent(im.dataset.frame)}`),{headers:{"X-Creator-Token":S.token}});if(r.ok&&im.isConnected)im.src=mediaUrl(await r.blob());}catch{}
    });
    if(locked)return;
    const closeDrawer=()=>{$("attachment-drawer").hidden=true;$("attach-open").focus();};
    $("attach-open").onclick=()=>{$("attachment-drawer").hidden=false;$("edit-audio").focus();};
    $("drawer-backdrop").onclick=$("drawer-close").onclick=closeDrawer;
    $("attachment-drawer").onkeydown=event=>{if(event.key==="Escape")closeDrawer();if(event.key==="Tab"){const items=[...$("attachment-drawer").querySelectorAll('.attachment-sheet button:not(:disabled)')];if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1).focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus();}}};
    const sizeText = n => `${fa((n/1048576).toFixed(1))} مگابایت`;
    const preview=()=>{
      $("pending-media").innerHTML=pending.map((p,i)=>`<div class="pending-item">${p.type==="audio"?MediaUI.audio(p.url,{peaks:p.peaks}):MediaUI.video(p.url)}<p class="file-size">${sizeText(p.file.size)}${p.originalFile?` · اصل: ${sizeText(p.originalFile.size)}`:""}${p.saving?" · در حال ذخیره…":p.saved?" · ذخیره شد":" · ذخیره نشده"}</p>
      ${p.type==="video"&&!p.originalFile&&window.MediaPrep?.available()?`<button class="btn ghost" data-prepare="${i}" ${p.saving||sending?"disabled":""}>کاهش حجم آزمایشی</button>`:""}${p.originalFile?`<button class="btn ghost" data-original="${i}" ${sending?"disabled":""}>استفاده از اصل فایل</button>`:""}<button class="btn ghost" data-drop="${i}" ${p.saving||sending?"disabled":""}>حذف</button></div>`).join("");
      MediaUI.bind($("pending-media"));
      document.querySelectorAll("[data-drop]").forEach(b=>b.onclick=async()=>{const p=pending[+b.dataset.drop];URL.revokeObjectURL(p.url);pending.splice(+b.dataset.drop,1);preview();try{await saveDraft();await ChatDraft.drop(S.me.phone,p.id);}catch{draftError();}});
      document.querySelectorAll("[data-original]").forEach(b=>b.onclick=async()=>{const p=pending[+b.dataset.original];p.file=p.originalFile;p.originalFile=null;URL.revokeObjectURL(p.url);p.url=mediaUrl(p.file);p.saving=true;preview();try{await ChatDraft.putFile(S.me.phone,p);await saveDraft();p.saved=true;}catch{draftError();}finally{p.saving=false;preview();}});
      document.querySelectorAll("[data-prepare]").forEach(b=>b.onclick=async()=>{
        const p=pending[+b.dataset.prepare];preparation=new AbortController();sending=true;
        const controls=[...document.querySelectorAll(".chat-composer button,.chat-composer textarea")];controls.forEach(c=>c.disabled=true);
        $("cancel-send").hidden=false;$("cancel-send").disabled=false;$("cancel-send").textContent="لغو آماده‌سازی";$("cancel-send").onclick=()=>preparation.abort();
        $("send-progress").textContent="صفحه رو باز نگه دار؛ تبدیل تقریباً هم‌مدت ویدیوست.";
        try{const result=await MediaPrep.compress(p.file,{signal:preparation.signal,onProgress:n=>$("send-progress").textContent=`آماده‌سازی روی گوشی ${fa(Math.round(n*100))}٪`});
          if(!result.original){p.originalFile=p.file;p.file=result.file;URL.revokeObjectURL(p.url);p.url=mediaUrl(p.file);p.saving=true;try{await ChatDraft.putFile(S.me.phone,p);await saveDraft();p.saved=true;}catch{p.saved=false;draftError();}finally{p.saving=false;}}
          $("send-progress").textContent=result.original?result.reason:"آماده شد؛ قبل از ارسال تصویر و صدا رو پخش کن.";
        }catch(err){if(location.hash===`#/edit/${e.id}`)$("send-progress").textContent=err.message;}
        finally{sending=false;preparation=null;if(location.hash===`#/edit/${e.id}`){controls.forEach(c=>c.disabled=false);$("cancel-send").hidden=true;preview();}}
      });
    };
    const add=async files=>{
      for(const f of files){const kind=f.type.startsWith("audio/")||/\.(mp3|wav|m4a|aac|flac|opus|ogg)$/i.test(f.name)?"audio":f.type.startsWith("video/")||/\.(mp4|mov|mkv|avi|webm|m4v|3gp|mts|m2ts|mpeg|mpg)$/i.test(f.name)?"video":null;if(!kind){toast("فقط صوت و ویدیو بفرست.");continue;}if(pending.length>=10){toast("حداکثر ده فایل در هر پیام.");break;}
        const p={id:Date.now().toString(36)+Math.random().toString(36).slice(2),file:f,type:kind,url:mediaUrl(f),saving:true};pending.push(p);preview();
        try{await ChatDraft.putFile(S.me.phone,p);p.saved=true;if(p.type==="audio")p.peaks=await MediaUI.peaks(p.file);}catch{p.saved=false;draftError();}finally{p.saving=false;if(location.hash===`#/edit/${e.id}`){preview();await saveDraft().catch(draftError);}}
      }
    };
    // Pending files survive ordinary rerenders in the same chat; refresh their object URLs.
    pending.forEach(p=>p.url=mediaUrl(p.file));preview();
    const choose=(capture=false)=>{const input=document.createElement("input");input.type="file";input.accept=capture?"video/*":"video/*,audio/*";input.multiple=!capture;if(capture)input.setAttribute("capture","user");input.onchange=()=>add([...input.files]);input.click();};
    $("edit-files").onclick=()=>{closeDrawer();choose();};
    const record=async type=>{
      if(!hasCapture()){if(type==="video")return choose(true);return toast("ضبط صدا به HTTPS نیاز داره؛ فایل صوتی انتخاب کن.");}
      try{
        stream=await navigator.mediaDevices.getUserMedia({audio:true,video:type==="video"?{facingMode:"user",width:{ideal:1080},height:{ideal:1920}}:false});
        const chunks=[];discardRecording=false;recorder=new MediaRecorder(stream);
        $("edit-audio").disabled=$("edit-video").disabled=$("edit-send").disabled=$("attach-open").disabled=true;
        $("record-stage").innerHTML=`<div class="live-recording">${type==="video"?'<video id="camera-live" muted autoplay playsinline></video>':""}<div class="live-wave-row"><span class="record-dot"></span><time id="record-time">0:00</time><canvas id="record-wave" aria-label="موج زندهٔ میکروفن"></canvas></div><div class="record-actions"><button class="btn ghost" id="record-cancel">لغو</button><button class="btn" id="record-stop">پایان ضبط</button></div></div>`;
        if($("camera-live"))$("camera-live").srcObject=stream;
        liveWaveStop=MediaUI.live(stream,$("record-wave"),$("record-time"));
        recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
        recorder.onstop=()=>{
          const mime=recorder.mimeType||chunks[0]?.type||`${type}/webm`, blob=new Blob(chunks,{type:mime});
          stopTracks();if(location.hash!==`#/edit/${e.id}`)return;
          $("record-stage").innerHTML="";$("edit-audio").disabled=$("edit-video").disabled=$("edit-send").disabled=$("attach-open").disabled=false;
          if(blob.size&&!discardRecording)add([new File([blob],`recording-${Date.now()}.${mime.includes("mp4")?"mp4":"webm"}`,{type:mime,lastModified:Date.now()})]);
        };
        recorder.onerror=()=>{stopRecording();toast("ضبط متوقف شد؛ دوباره امتحان کن.");};
        recorder.start(1000);$("record-stop").onclick=stopRecording;$("record-cancel").onclick=()=>{discardRecording=true;stopRecording();};recordTimer=setTimeout(stopRecording,180000);
      }catch(err){stopTracks();toast("اجازهٔ میکروفن یا دوربین داده نشد.",{type:"err"});}
    };
    $("edit-audio").onclick=()=>{closeDrawer();record("audio");};$("edit-video").onclick=()=>{closeDrawer();record("video");};
    $("edit-send").onclick=async()=>{
      if(sending)return;
      const text=$("edit-text").value.trim(), part=activePart;
      if(!text&&!pending.length)return toast("متن یا فایل بفرست.");
      const limit=S.config.maxUploadBytes||400*1048576;
      if(pending.some(p=>p.file.size>limit))return toast(`سقف ارسال ${sizeText(limit)} است؛ کاهش حجم رو امتحان کن.`,{type:"err",ms:7000});
      const ctl=uploadCtl();activeUpload=ctl;sending=true;
      const sendButton=$("edit-send"),sendMarkup=sendButton.innerHTML;
      sendButton.innerHTML='<span class="send-spinner" aria-hidden="true"></span>';sendButton.setAttribute("aria-label","در حال ارسال");
      const controls=[...document.querySelectorAll(".chat-composer button,.chat-composer textarea,.chat-composer select")];controls.forEach(b=>b.disabled=true);
      $("cancel-send").hidden=false;$("cancel-send").disabled=false;$("cancel-send").textContent="لغو آپلود";$("cancel-send").onclick=()=>ctl.cancel();
      $("send-progress").textContent="در حال آماده‌سازی فایل…";
      try{
        const files=[];
        for(const p of pending){const upload=await uploadResumable(p.file,got=>{$("send-progress").textContent=`آپلود ${fa(Math.floor(got/p.file.size*100))}٪`;},()=>{$("send-progress").textContent="اتصال قطع شد؛ ادامه می‌دم…";},ctl);files.push({upload,type:p.type,name:p.file.name,mime:p.file.type});}
        if(ctl.cancelled)throw Object.assign(Error("آپلود لغو شد؛ فایل‌ها محفوظ‌اند."),{cancelled:true});
        $("cancel-send").disabled=true;
        const next=await request(`/api/edits/${e.id}/messages`,{method:"POST",body:{text,part,files}});
        pending=[];draftFields={text:"",part:""};await ChatDraft.clear(S.me.phone).catch(draftError);sending=false;showChat(next);
      }catch(err){
        sending=false;activeUpload=null;
        if(location.hash!==`#/edit/${e.id}`)return;
        controls.forEach(b=>b.disabled=false);$("cancel-send").hidden=true;sendButton.innerHTML=sendMarkup;sendButton.setAttribute("aria-label","ارسال و بررسی");
        const unreadable=err.name==="NotReadableError"||err.name==="NotFoundError"||/could not be read|not readable/i.test(err.message||"");
        const network=/failed to fetch|network|load failed/i.test(err.message||"");
        const reason=err.cancelled?"آپلود لغو شد؛ می‌تونی ادامه بدی.":unreadable?"گوشی دسترسی به ویدیو رو قطع کرده؛ دوباره انتخابش کن.":network?"اتصال قطع شد؛ دوباره ارسال کن.":err.message||"ارسال ناموفق بود؛ دوباره امتحان کن.";
        $("send-progress").textContent=reason;$("send-progress").setAttribute("role","alert");
        console.warn("media-send",{name:err.name,reason:err.message,files:pending.map(p=>({type:p.type,size:p.file.size}))});
      }
    };
  }

  views.settings=()=>{
    const p=S.me.plan,u=S.me.usage||{};
    $app.innerHTML=`<h1>حساب من</h1><div class="card"><div class="row"><span>نام</span><button class="link" id="account-name">${esc(S.me.name)} ✎</button></div><div class="row"><span>موبایل</span><bdi>${esc(fa(S.me.phone))}</bdi></div></div>
      <div class="card"><div class="row"><span>پلن</span><b>${esc(S.me.admin?"مدیر":p?.name||"غیرفعال")}</b></div><div class="row"><span>ریلز امروز</span><span>${fa(p?.used?.reelsToday||0)}</span></div><div class="row"><span>توکن مصرف‌شده</span><span>${fa(u.tokens||0)}</span></div></div>
      ${S.me.admin?'<a class="btn" href="#/admin">پنل مدیریت</a>':""}<button class="btn ghost" id="account-logout">خروج</button>`;
    $("account-name").onclick=async()=>{const name=prompt("نام:",S.me.name);if(name?.trim()){try{S.me=await request("/api/me",{method:"PUT",body:{name}});views.settings();}catch{}}};
    $("account-logout").onclick=async()=>{leave();pending=[];await api("/api/auth/logout",{method:"POST"}).catch(()=>{});setToken(null);S.me=null;S.jobs=[];draftClear();go("#/login");};
  };
};
