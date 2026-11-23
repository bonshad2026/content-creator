import fs from "node:fs";
import path from "node:path";
import { jobDir } from "./media.js";
import { newId } from "./store.js";
import { takeUpload } from "./uploads.js";
import { analyzeEdit } from "./edit-analysis.js";
import { PRODUCT_TEMPLATE, assistantMessage, requirements, templateTimeline } from "./templates.js";
import {resolveEditTurn,recordWork,remainingMediaQuestion} from './edit-turn.js';
import {templateFingerprint} from './template-conversation.js';
import {normalizeAdjustments} from './adjustments.js';
import {createEditTrace,traceError} from './edit-trace.js';
import {prepareMediaEvidence} from './media-evidence.js';
import {captionText,assertCaptionEdits} from './caption-edits.js';
import {selectionState,executeCaptionChanges} from './template-changes.js';
import {PHOTO_MOTION_TEMPLATE} from './photo-motion.js';
import {isPhotoEdit,photoEditView,photoEditRoutes} from './photo-edit.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const renderedTimeline=job=>{
  try{const saved=JSON.parse(fs.readFileSync(path.join(jobDir(job.id),'timeline.json'),'utf8'));if(Array.isArray(saved)&&saved.every(c=>c&&typeof c.segmentId==='string'&&Number.isFinite(c.start)&&Number.isFinite(c.end)))return saved;}catch{}
  try{return templateTimeline(job.templateData.analysis,job.templateData.assets);}catch{return null;}
};
const selectionKey=a=>a?JSON.stringify([[...a.opening].sort(),[...a.closing].sort(),a.products.map((p,i)=>[p.id||`product-${i}`,p.name,[...p.speech].sort(),[...p.visuals].sort()]).sort((a,b)=>a[0].localeCompare(b[0]))]):null;
const confirmationReply=text=>{const t=text.replace(/[يك]/g,c=>c==='ي'?'ی':'ک').replace(/[\u200c،,.!؟?؛]/g,' ').replace(/\s+/g,' ').trim();return /^(بله|بله درسته|بله درست است|آره|آره درسته|اره|اره درسته|درسته|درست است|تایید|تأیید|اوکی|صحیحه|yes|ok)$/i.test(t)?true:/^(نه|خیر|اشتباهه|درست نیست|نه اشتباهه|نه درست نیست|no)$/i.test(t)?false:null;};
export function editRoutes(app, { db, save, requireUser, wrap, quota, enqueue, analyze = analyzeEdit,prepareMedia=prepareMediaEvidence }) {
  db.edits ??= [];
  // A restart never repeats paid analysis silently. Already transcribed assets remain cached.
  for (const e of db.edits) if (e.status === "analyzing") {
    const kind=e.renderPreparationTraceId?'render':'analysis';
    const trace=createEditTrace({editId:e.id,kind,trigger:'server_restart'},{resumeId:e.renderPreparationTraceId||e.analysisTraceId||null});
    trace.record(`${kind}.interrupted`,{reason:'server_restart'});delete e.renderPreparationTraceId;
    e.status = "error"; e.error = "بررسی متوقف شد؛ دوباره تلاش کن.";
  }
  // Migrate historical parallel drafts without discarding their chats or files.
  const latest = new Map();
  for(const e of [...db.edits].sort((a,b)=>b.createdAt-a.createdAt))if(!e.jobId&&!e.archived){if(latest.has(e.userId))e.archived=true;else latest.set(e.userId,e.id);}
  for(const e of db.edits)if(!e.jobId&&!e.archived&&e.dialogue?.disposition==='unsupported'){e.dialogue.blocked=false;e.dialogue.question=null;e.dialogue.ignored=true;e.dialogue.memory=e.dialogue.previousMemory||{goal:'',constraints:[]};}
  for(const e of db.edits)if(e.analysis&&!e.jobId&&!e.archived&&['awaiting','ready'].includes(e.status)){
    const ready=!e.dialogue?.blocked&&requirements(e.analysis,e.assets,e.confirmed).every(r=>r.done);
    if(ready&&e.status==='awaiting'&&e.messages.at(-1)?.part==='transcript-review')e.messages.push(assistantMessage('بازبینی متن اختیاریه؛ می‌تونی ساخت رو ادامه بدی.'));
    e.status=ready?'ready':'awaiting';
  }
  const own = (req) => {
    const e = db.edits.find(e => e.id === req.params.id && e.userId === req.user.id);
    if (!e) throw fail(404, "گفت‌وگو پیدا نشد.");
    if(isPhotoEdit(e)&&req.method==='POST')throw fail(400,'این عملیات در قالب موشن تک‌عکس پشتیبانی نمی‌شود.');
    return e;
  };
  const mediaCookie=(req,res)=>{if(req.token)res.cookie("creator_media",req.token,{httpOnly:true,sameSite:"strict",secure:req.secure||req.get("x-forwarded-proto")==="https",path:(req.baseUrl||"")+"/api/edits",maxAge:86400000});};
  const requireMediaUser=(req,res,next)=>{if(!/^Bearer /.test(req.get("authorization")||"")){const m=/(?:^|;\s*)creator_media=([A-Za-z0-9_-]+)/.exec(req.get("cookie")||"");if(m)req.headers.authorization="Bearer "+m[1];}return requireUser(req,res,next);};
  const renderDecision=e=>{
    if(e.jobId||e.archived)return {canBuild:false,reason:'closed',existingJobId:e.jobId||null};
    if(['analyzing','rendering'].includes(e.status))return {canBuild:false,reason:'processing'};
    if(e.status!=='ready'||e.dialogue?.blocked||Object.values(e.work?.media||{}).some(b=>b.use==='pending')||!e.analysis||!e.assets.length||requirements(e.analysis,e.assets,e.confirmed).some(r=>!r.done))return {canBuild:false,reason:'missing-input'};
    const parent=e.revisionOf?db.jobs.find(j=>j.id===e.revisionOf&&j.userId===e.userId):null,parentPlan=parent?.templateData?renderedTimeline(parent):null;
    if(parentPlan&&templateFingerprint(e.analysis,e.assets)===templateFingerprint(parent.templateData.analysis,parent.templateData.assets,parentPlan))return {canBuild:false,reason:'no-change',existingJobId:parent.id};
    return {canBuild:true,reason:'ready'};
  };
  const view = e => isPhotoEdit(e)?photoEditView(e,db):({ id: e.id, templateId: e.templateId, status: e.status, build:renderDecision(e),error: e.error, jobId: e.jobId, createdAt: e.createdAt,
    messages: e.messages,progress:e.progress||null, dialogue:e.dialogue?{blocked:e.dialogue.blocked,errorKind:e.dialogue.errorKind||null,understanding:e.dialogue.understanding,question:e.dialogue.question,subject:e.dialogue.subject}:null, usage: e.usage, archived: !!e.archived, mediaExpired:!!e.mediaExpired, demo: !process.env.GAPGPT_API_KEY,
    confirmationRejected:!!e.confirmationRejected,revisionOf:e.revisionOf||null, versions:db.jobs.filter(j=>j.editId===e.id).map(j=>({id:j.id,status:j.status,createdAt:j.createdAt,video:j.video,revisionOf:j.revisionOf||null})),
    assets: e.assets.map(a => ({ id: a.id, type: a.type, name: a.name, duration: a.duration, part: a.part, inspected: a.inspected,waveform:a.waveform||null })),
    requirements: [...requirements(e.analysis, e.assets, e.confirmed),...(e.dialogue?.blocked?[{id:'dialogue',label:'تکمیل درخواست فعلی',done:false,prompt:e.dialogue.reply,accepts:'text'}]:[])],
    selection: e.analysis ? { products: e.analysis.products, opening: e.analysis.opening, closing: e.analysis.closing,corrections:e.analysis.corrections||[],captionEdits:e.analysis.captionEdits||[],adjustments:normalizeAdjustments(e.analysis.adjustments,e.assets).value } : null,
    segments: e.assets.flatMap(a => (a.segments || []).map(s => ({ id: s.id, text: s.text,captionText:captionText(e.analysis,s), assetId: a.id, start: s.start, end: s.end }))),
    frames: e.assets.flatMap(a => (a.frames || []).map(f => ({ id: f.id, assetId: a.id }))),
  });
  const mutable = e => {
    if(e.archived)throw fail(409,"پیش‌نویس فعال دیگری داری؛ همان رو ادامه بده.");
    if (["analyzing", "rendering"].includes(e.status)) throw fail(409, "صبر کن؛ پردازش هنوز تمام نشده.");
    if (e.jobId) throw fail(409, "این گفت‌وگو قبلاً وارد ساخت شده.");
  };
  let chain = Promise.resolve();
  const actionTrace=(e,action)=>{
    const trace=createEditTrace({editId:e.id,kind:'action',action,analysisTraceId:e.analysisTraceId||null,previousActionTraceId:e.actionTraceId||null,revisionOf:e.revisionOf||null});
    e.actionTraceId=trace.id;
    trace.record('action.input',{status:e.status,analysis:e.analysis,dialogue:e.dialogue,confirmed:e.confirmed,archived:e.archived,turn:e.messages.at(-1)});
    return trace;
  };
  const confirmSelection=(e,accepted)=>{
    if(accepted&&e.confirmed)return;
    const trace=actionTrace(e,accepted?'confirm':'reject_confirmation');
    e.confirmed=accepted;e.confirmedKey=accepted?selectionKey(e.analysis):null;e.confirmationRejected=!accepted;
    const missing=requirements(e.analysis,e.assets,e.confirmed).filter(r=>!r.done);
    e.status=missing.length?'awaiting':'ready';
    const next=accepted?missing[0]:null;
    e.messages.push({...assistantMessage(accepted?(next?.prompt||"تأیید شد؛ می‌تونی ساخت رو بزنی."):"اشتباه رو بگو؛ نام محصول یا بخش درست رو بنویس."),part:accepted?(next?.id||''):'correction',label:accepted?(next?.label||''):'اصلاح تشخیص'});
    trace.record('action.completed',{status:e.status,confirmed:e.confirmed,confirmedKey:e.confirmedKey,confirmationRejected:e.confirmationRejected,reply:e.messages.at(-1)});
  };
  const begin = (e, user, trigger = 'message', revisionOf = e.revisionOf || null) => {
    quota(user, "reel");
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });
    user.editChecks ??= { day, n: 0 };
    if (user.editChecks.day !== day) user.editChecks = { day, n: 0 };
    const checkLimit=Number.isInteger(user.editCheckLimit)&&user.editCheckLimit>0?user.editCheckLimit:40;
    if (user.editChecks.n >= checkLimit) throw fail(429, "سهم بررسی امروز تمام شد؛ فردا ادامه بده.");
    user.editChecks.n++;
    let approved=e.confirmed?selectionKey(e.analysis):null;
    const trace=createEditTrace({editId:e.id,kind:'analysis',trigger,revisionOf,previousTraceId:e.analysisTraceId||null});
    e.analysisTraceId=trace.id;
    trace.record('analysis.queued', {approved:trigger==='revision'?null:approved});
    e.status = "analyzing"; e.error = null;e.progress={stage:'queued',startedAt:Date.now()}; save();
    chain = chain.then(async () => {
      try {
        if(trigger==='revision')approved=e.confirmed?selectionKey(e.analysis):null;
        const previous=e.analysis?structuredClone(e.analysis):null;
        const previousMemory=e.dialogue?.blocked?e.dialogue.previousMemory:e.dialogue?.memory||null;
        // begin() reserves the queue before the route appends its message/assets.
        // Capture inside the queued task so this snapshot includes that exact turn.
        trace.record('analysis.input', {edit:{id:e.id,templateId:e.templateId,revisionOf:e.revisionOf||null,revisionBaseline:e.revisionBaseline||null,work:e.work||null,contextStart:e.contextStart||0,messages:e.messages,assets:e.assets,analysis:previous,dialogue:e.dialogue||null,confirmed:e.confirmed,archived:!!e.archived},previousMemory,approved});
        const analysis = await analyze(e, jobDir(`edit-${e.id}`), u => {
          trace.record('analysis.usage', u);
          e.usage.tokens += u.tokens || 0; e.usage.cost += u.cost || 0;
          user.usage ??= { tokens: 0, cost: 0 };
          user.usage.tokens += u.tokens || 0; user.usage.cost += u.cost || 0;
          save();
        },progress=>{trace.record('analysis.progress', progress);e.progress={...progress,startedAt:e.progress?.startedAt||Date.now()};save();},trace);
        trace.record('analysis.result', {data:analysis,assets:e.assets});
        e.progress={stage:'validating_changes',startedAt:e.progress?.startedAt||Date.now()};
        const turn=e.messages.findLast(m=>m.role==='user')||{};
        const transitionInput={previous,proposal:analysis,assets:e.assets,turn,previousMemory};
        trace.record('turn.input',transitionInput);
        const outcome=resolveEditTurn(transitionInput),adjustmentWarnings=outcome.warnings;
        trace.record('turn.result',outcome);
        if(outcome.validation){trace.record('dialogue.validation_input',{decision:outcome.validation.decision,context:outcome.validation.context});trace.record('dialogue.validation_result',outcome.validation.outcome);}
        e.analysis=outcome.analysis;
        if(outcome.dialogue){
          const pending=outcome.dialogue.mediaBindings.filter(b=>b.use==='pending').map(b=>b.assetId);
          const assetIds=pending.length?pending:turn.assetIds?.length?turn.assetIds:outcome.dialogue.mediaBindings.filter(b=>b.use!=='unused').map(b=>b.assetId);
          const previousSubject=e.dialogue?.subject;
          const subject={request:turn?.choice&&previousSubject?previousSubject.request:turn?.text||'فایل ارسال‌شده',goal:outcome.dialogue.memory.goal.slice(0,220),files:assetIds.length?e.assets.filter(a=>assetIds.includes(a.id)).map(a=>({id:a.id,name:a.name})):previousSubject?.files||[]};
          e.dialogue={...outcome.dialogue,subject,ignored:!!outcome.ignored,previousMemory,blocked:outcome.blocked,errorKind:outcome.errorKind||null,problems:outcome.problems,question:outcome.dialogue.question?{...outcome.dialogue.question,id:newId()}:null};
        }else e.dialogue=null;
        e.work=recordWork(e.work,{id:newId(),turn,turnId:turn.clientMessageId||`message-${e.messages.lastIndexOf(turn)}`,revisionOf:e.revisionOf,result:outcome});
        const pendingQuestion=remainingMediaQuestion(e.work);
        if(!outcome.blocked&&pendingQuestion){e.dialogue={...e.dialogue,blocked:true,question:{...pendingQuestion.question,id:newId()},reply:pendingQuestion.question.text,subject:{request:pendingQuestion.request,goal:e.dialogue?.memory?.goal||'',files:e.assets.filter(a=>pendingQuestion.assetIds.includes(a.id)&&e.work.media[a.id]?.use==='pending').map(a=>({id:a.id,name:a.name}))}};}
        e.confirmed=!!approved&&approved===selectionKey(e.analysis);e.confirmedKey=e.confirmed?approved:null;e.confirmationRejected=false;
        const missing = requirements(e.analysis, e.assets,e.confirmed).filter(r => !r.done);
        e.status = outcome.errorKind?'error':missing.length||e.dialogue?.blocked ? "awaiting" : "ready";e.progress=null;
        e.error=outcome.errorKind?'این تغییر اجرا نشد؛ دوباره امتحان کن.':null;
        const reply=outcome.dialogue?.reply||e.dialogue?.reply;
        const fallback=outcome.execution.changed?'تغییر در ادیت ثبت شد.':e.dialogue?.question?'یک سؤال برای ادامه دارم.':undefined;
        e.messages.push({ ...assistantMessage(!process.env.GAPGPT_API_KEY ? "حالت نمایشی است؛ محتوای گفتار بررسی نشده." : reply||missing[0]?.prompt || "ورودی‌ها کامل شد؛ بخش‌ها رو ببین و ساخت رو بزن.",fallback), part:e.dialogue?.blocked?'dialogue':missing[0]?.id || "", label: e.dialogue?.ignored?'تغییر اعمال نشد':e.dialogue?.blocked?'درخواست فعلی':missing[0]?.label || "" });
        for(const warning of adjustmentWarnings)e.messages.push({...assistantMessage(warning),label:'تنظیم اعمال‌نشده'});
        trace.record('analysis.completed', {status:e.status,analysis:e.analysis,dialogue:e.dialogue,work:e.work,confirmed:e.confirmed,confirmedKey:e.confirmedKey,requirements:requirements(e.analysis,e.assets,e.confirmed),deliveredMessages:e.messages.slice(-1-adjustmentWarnings.length)});
      } catch (err) {
        trace.record('analysis.error', {error:traceError(err)});
        console.error("edit analysis", e.id, err.status || "", err.message);
        e.status = "error";e.progress=null; e.error = ['pre_consume_token_quota_failed','insufficient_quota','insufficient_balance'].includes(err.code)?'سرویس هوش مصنوعی درخواست را به‌دلیل محدودیت اعتبار رد کرد.':"بررسی ناموفق بود؛ فایل‌ها محفوظ‌اند. دوباره تلاش کن.";
      }
      save();
    }).catch(err => { trace.record('analysis.error',{phase:'queue',error:traceError(err)});console.error("edit queue", err.message); e.status = "error"; save(); });
  };
  photoEditRoutes(app,{db,save,requireUser,wrap,quota,enqueue,mediaCookie,requireMediaUser});
  app.get("/api/templates", requireUser, (_req,res) => res.json([PRODUCT_TEMPLATE,PHOTO_MOTION_TEMPLATE]));
  app.get("/api/edits", requireUser, (req,res) => res.json(db.edits.filter(e => e.userId === req.user.id).slice(-50).reverse().map(view)));
  app.post("/api/edits", requireUser, wrap(async (req,res) => {
    const template=[PRODUCT_TEMPLATE,PHOTO_MOTION_TEMPLATE].find(t=>t.id===req.body.templateId);
    if (!template) throw fail(400, "قالب معتبر انتخاب کن.");
    const active=db.edits.find(e=>e.userId===req.user.id&&!e.jobId&&!e.archived);
    if(active)return res.json(view(active));
    quota(req.user, "reel");
    const e = { id: newId(), userId: req.user.id, templateId: template.id, templateVersion: template.version,
      assets: [], messages: [assistantMessage(template.id===PHOTO_MOTION_TEMPLATE.id?'یک عکس محصول بفرست.':"ویدیوهای خامت رو بفرست؛ تپق‌ها مهم نیستن.")], status: "awaiting", usage: { tokens: 0, cost: 0 }, createdAt: Date.now() };
    db.edits.push(e); save(); res.json(view(e));
  }));
  app.get("/api/edits/:id", requireUser, wrap(async (req,res) => {const e=own(req);mediaCookie(req,res);res.json(view(e));}));
  app.post("/api/edits/:id/revise",requireUser,wrap(async(req,res)=>{
    const e=own(req), job=db.jobs.find(j=>j.id===req.body.jobId&&j.editId===e.id&&j.userId===req.user.id);
    if(!job||job.status!=="done"||!job.templateData)throw fail(400,"یک نسخهٔ آماده برای اصلاح انتخاب کن.");
    // A response-loss retry returns this revision instead of spending another analysis.
    if(!e.jobId&&e.revisionOf===job.id&&!e.archived)return res.json(view(e));
    const active=db.edits.find(d=>d.userId===req.user.id&&!d.jobId&&!d.archived);
    if(active) return res.status(409).json({error:"اول ادیت فعلی رو تکمیل یا لغو کن.",activeEditId:active.id});
    if(["analyzing","rendering"].includes(e.status)&&e.jobId&&db.jobs.some(j=>j.id===e.jobId&&["queued","running"].includes(j.status)))throw fail(409,"ساخت نسخهٔ فعلی هنوز تمام نشده.");
    const text=String(req.body.text||"").trim();
    if(!text||text.length>1000)throw fail(400,"اصلاح موردنظرت رو کوتاه توضیح بده.");
    const snapshot=structuredClone(job.templateData),dir=jobDir(`edit-${e.id}`),from=jobDir(job.id);
    const revisionBaseline={selection:structuredClone(snapshot.analysis),timeline:(renderedTimeline(job)||[]).map(c=>({segmentId:c.segmentId,start:c.start,end:c.end,videoAsset:c.videoAsset}))};
    if(snapshot.assets.some(a=>!fs.existsSync(path.join(from,a.file))&&!fs.existsSync(path.join(dir,a.file))))throw fail(410,"مهلت فایل خام تمام شده؛ برای اصلاح، فایل‌ها رو دوباره بفرست.");
    quota(req.user,"reel");
    for(const a of snapshot.assets){const target=path.join(dir,a.file);if(!fs.existsSync(target)){try{fs.linkSync(path.join(from,a.file),target);}catch{fs.copyFileSync(path.join(from,a.file),target);}}}
    // Reserve analysis before reopening; no automatic paid work on page load.
    begin(e,req.user,'revision',job.id);
    e.assets=snapshot.assets;e.analysis=snapshot.analysis;e.revisionOf=job.id;e.revisionBaseline=revisionBaseline;e.jobId=null;e.archived=false;e.mediaExpired=false;
    e.contextStart=e.messages.length;
    e.dialogue={memory:structuredClone(job.conversationSnapshot?.memory||null),blocked:false,question:null};
    e.work=structuredClone(job.conversationSnapshot?.work||{active:null,decisions:[],media:{}});
    e.confirmed=job.conversationSnapshot?.confirmed??true;e.confirmedKey=e.confirmed?selectionKey(snapshot.analysis):null;
    e.messages.push({role:"user",text:`درخواست اصلاح نسخه: ${text}`,at:Date.now()});
    save();mediaCookie(req,res);res.status(202).json(view(e));
  }));
  app.post("/api/edits/:id/discard",requireUser,wrap(async(req,res)=>{
    const e=own(req);
    if(e.jobId)throw fail(409,"این ادیت وارد ساخت شده؛ پیش‌نویس نیست.");
    if(req.body.confirm!==true)throw fail(400,"لغو ادیت رو تأیید کن.");
    const trace=actionTrace(e,'discard');
    e.archived=true;e.archivedAt=Date.now();save();res.json(view(e));
    trace.record('action.completed',{archived:e.archived,archivedAt:e.archivedAt});
  }));
  app.post("/api/edits/:id/messages", requireUser, wrap(async (req,res) => {
    const e = own(req);
    const clientMessageId=String(req.body.clientMessageId||"");
    if(clientMessageId&&!/^[A-Za-z0-9_-]{8,80}$/.test(clientMessageId))throw fail(400,"شناسهٔ پیام نامعتبر است.");
    if(clientMessageId&&e.messages.some(m=>m.clientMessageId===clientMessageId)){mediaCookie(req,res);return res.json(view(e));}
    mutable(e);
    const files = req.body.files;
    if (files !== undefined && (!Array.isArray(files) || files.length > 10)) throw fail(400, "حداکثر ده فایل در هر پیام بفرست.");
    if (e.assets.length + (files?.length || 0) > 30) throw fail(400, "حداکثر سی فایل برای هر ادیت.");
    const choice=req.body.choice;let selectedChoice;
    let text = String(req.body.text || "").trim().slice(0,1000);
    if(choice){const question=e.dialogue?.question,selected=question?.choices.find(c=>c.id===choice.id);if(!question||question.id!==choice.questionId||!selected)throw fail(409,'این سؤال تغییر کرده؛ صفحه رو تازه کن.');text=selected.label;selectedChoice=selected;}
    const part = String(req.body.part || "").slice(0,60);
    if (!text && !files?.length) throw fail(400, "متن یا فایل بفرست.");
    const lastAssistant=e.messages.findLast(m=>m.role==='assistant');
    const reply=!files?.length&&e.analysis?.uncertain&&!e.confirmed&&(part==='confirm'||lastAssistant?.part==='confirm')?confirmationReply(text):null;
    if(reply!==null){e.messages.push({role:'user',text,assetIds:[],part:'confirm',at:Date.now(),...(clientMessageId?{clientMessageId}:{})});confirmSelection(e,reply);save();mediaCookie(req,res);return res.json(view(e));}
    quota(req.user, "reel");
    const attached = [], dir = jobDir(`edit-${e.id}`);
    try {
      for (const file of files || []) {
        if (!["video","audio"].includes(file.type)) throw fail(400, "صوت یا ویدیو بفرست.");
        const id = newId(), name = String(file.name || "فایل").slice(0,100);
        const product = requirements(e.analysis,e.assets,e.confirmed).find(r => r.id === part)?.product || "";
        const asset = { id, type: file.type, name, file: `${id}.media`, part, product, mime: String(file.mime || "").slice(0,80), inspected: false };
        takeUpload(db, req.user, String(file.upload), path.join(dir, asset.file));
        attached.push(asset);
      }
      // Reserve analysis before mutating the chat; failed rate checks keep its evidence unchanged.
      begin(e, req.user);
    } catch(err) { attached.forEach(a => fs.rmSync(path.join(dir,a.file),{force:true})); throw err; }
    e.assets.push(...attached);
    e.messages.push({ role: "user", text, assetIds: attached.map(a => a.id), part, at: Date.now(),...(choice?{choice:{id:choice.id,questionId:choice.questionId,value:selectedChoice.value}}:{}),...(clientMessageId?{clientMessageId}:{}) });
    save();mediaCookie(req,res);res.status(202).json(view(e));
  }));
  app.post("/api/edits/:id/analyze", requireUser, wrap(async (req,res) => {
    const e = own(req); mutable(e); if (!e.assets.length) throw fail(400,"اول ویدیوهای خامت رو بفرست.");
    begin(e,req.user,'retry'); res.status(202).json(view(e));
  }));
  app.post('/api/edits/:id/cancel-request',requireUser,wrap(async(req,res)=>{
    const e=own(req);mutable(e);if(!e.dialogue?.blocked)return res.json(view(e));
    const trace=actionTrace(e,'cancel_request');
    if(e.work?.active){e.work.decisions.push({...e.work.active,id:newId(),status:'cancelled'});e.work.decisions=e.work.decisions.slice(-40);e.work.active=null;}
    for(const binding of Object.values(e.work?.media||{}))if(binding.use==='pending')binding.use='unused';
    if(e.work)e.work.pendingQuestions={};
    e.dialogue={memory:e.dialogue.previousMemory||null,blocked:false,question:null,disposition:'answer',understanding:'',reply:'درخواست لغو شد.'};
    e.status=requirements(e.analysis,e.assets,e.confirmed).some(r=>!r.done)?'awaiting':'ready';
    e.error=null;
    e.messages.push({role:'user',text:'از درخواست فعلی صرف‌نظر می‌کنم.',at:Date.now()},assistantMessage(e.dialogue.reply));save();res.json(view(e));
    trace.record('action.completed',{status:e.status,dialogue:e.dialogue,reply:e.messages.at(-1)});
  }));
  app.post("/api/edits/:id/confirm", requireUser, wrap(async (req,res) => {
    const e = own(req); mutable(e); if (!e.analysis) throw fail(400,"اول بررسی رو کامل کن.");
    const accepted=req.body.accepted!==false;
    if((accepted&&e.confirmed)||(!accepted&&e.confirmationRejected))return res.json(view(e));
    e.messages.push({role:'user',text:accepted?'بله':'خیر',part:'confirm',at:Date.now()});
    confirmSelection(e,accepted);save();res.json(view(e));
  }));
  app.post("/api/edits/:id/transcript",requireUser,wrap(async(req,res)=>{
    const e=own(req);mutable(e);
    if(!Array.isArray(req.body.segments)||req.body.segments.length>200)throw fail(400,"متن گفتار نامعتبر است.");
    const all=new Map(e.assets.flatMap(a=>(a.segments||[]).map(s=>[s.id,s])));
    const edits=req.body.segments.map(s=>({segment:all.get(s.id),text:String(s.text||"").trim()}));
    if(edits.some(s=>!s.segment||!s.text||s.text.length>600))throw fail(400,"برای هر بخش، یک جملهٔ معتبر بنویس.");
    begin(e,req.user,'transcript');
    for(const {segment,text}of edits){if(text!==segment.text){segment.originalText??=segment.text;segment.text=text;segment.words=[];if(e.analysis?.captionEdits)e.analysis.captionEdits=e.analysis.captionEdits.filter(c=>c.id!==segment.id);}segment.userEdited=true;}
    e.messages.push({role:"user",text:"متن گفتار رو بازبینی و اصلاح کردم.",event:{type:'transcript_updated',status:'applied'},at:Date.now()});save();res.status(202).json(view(e));
  }));
  app.post('/api/edits/:id/captions',requireUser,wrap(async(req,res)=>{
    const e=own(req);mutable(e);
    if(!e.analysis||!Array.isArray(req.body.edits)||req.body.edits.length>200)throw fail(400,'اصلاح زیرنویس معتبر نیست.');
    const edits=req.body.edits.map(c=>({id:String(c?.id||''),text:String(c?.text||'').trim()}));assertCaptionEdits(edits,e.assets);
    const segments=new Map(e.assets.flatMap(a=>(a.segments||[]).map(s=>[s.id,s]))),changed=edits.filter(c=>captionText(e.analysis,segments.get(c.id))!==c.text);
    if(!changed.length)return res.json(view(e));
    const before=selectionState(e.analysis,e.assets);
    const trace=actionTrace(e,'caption_edit');trace.record('caption.input',{before,assets:e.assets,edits:changed});
    const result=executeCaptionChanges(before,e.assets,changed);
    if(result.problems.length)throw fail(400,'اصلاح زیرنویس اجرا نشد.');
    e.analysis=result.state;
    if(req.body.resolveRequest===true&&!Object.values(e.work?.media||{}).some(b=>b.use==='pending')){e.dialogue={memory:e.dialogue?.memory||null,blocked:false,question:null,disposition:'acknowledge',understanding:'اصلاح زیرنویس',reply:'متن زیرنویس اصلاح شد.'};if(e.work)e.work.active=null;}
    e.error=null;e.status=e.dialogue?.blocked||requirements(e.analysis,e.assets,e.confirmed).some(r=>!r.done)?'awaiting':'ready';
    const turn={role:'user',text:'متن زیرنویس را اصلاح کردم.',event:{type:'caption_updated',status:'applied'},at:Date.now()};
    e.messages.push(turn,assistantMessage('متن زیرنویس اصلاح شد.'));
    e.work=recordWork(e.work,{id:newId(),turn,turnId:`message-${e.messages.length-2}`,revisionOf:e.revisionOf,result:{dialogue:{mediaBindings:[]},execution:result,blocked:!!e.dialogue?.blocked}});
    trace.record('caption.completed',{analysis:e.analysis,execution:result});save();res.json(view(e));
  }));
  app.post("/api/edits/:id/render", requireUser, wrap(async (req,res) => {
    const e = own(req);
    const trace=createEditTrace({editId:e.id,kind:'render',analysisTraceId:e.analysisTraceId||null,actionTraceId:e.actionTraceId||null,revisionOf:e.revisionOf||null});
    trace.record('render.request',{status:e.status,dialogue:e.dialogue,confirmed:e.confirmed,analysis:e.analysis,assets:e.assets});
    let preparing=false;
    try {
    mutable(e);
    if(e.dialogue?.blocked)throw fail(409,'اول درخواست در انتظار رو روشن یا لغو کن.');
    if(Object.values(e.work?.media||{}).some(binding=>binding.use==='pending'))throw fail(409,'یک ورودی هنوز تعیین تکلیف نشده.');
    if(e.status!=="ready")throw fail(400,"اول بررسی ورودی‌ها رو کامل کن.");
    const decision=renderDecision(e);trace.record('render.eligibility',decision);
    if(!decision.canBuild)throw fail(409,decision.reason==='no-change'?'تغییری ایجاد نشده؛ خروجی فعلی آماده است.':'اول بررسی ورودی‌ها رو کامل کن.');
    preparing=true;e.renderPreparationTraceId=trace.id;e.status='analyzing';e.progress={stage:'checking_media',startedAt:Date.now()};save();
    await prepareMedia(e.assets,jobDir(`edit-${e.id}`),progress=>{e.progress={...progress,startedAt:e.progress.startedAt};save();});
    if(e.archived)throw fail(409,'این ادیت لغو شده.');
    e.progress=null;
    delete e.renderPreparationTraceId;
    e.status=requirements(e.analysis,e.assets,e.confirmed).some(r=>!r.done)?'awaiting':'ready';save();
    if (!e.assets.length || !e.analysis || requirements(e.analysis,e.assets,e.confirmed).some(r=>!r.done)) throw fail(400,"اول بخش‌های ضروری رو تکمیل کن.");
    templateTimeline(e.analysis,e.assets); // includes audio/video duration coverage, before consuming a reel
    const checked=renderDecision(e);trace.record('render.eligibility_after_prepare',checked);if(!checked.canBuild)throw fail(checked.reason==='no-change'?409:400,checked.reason==='no-change'?'تغییری ایجاد نشده؛ خروجی فعلی آماده است.':'اول بررسی ورودی‌ها رو کامل کن.');
    quota(req.user,"reel");
    const id = newId(), dir = jobDir(id), from = jobDir(`edit-${e.id}`);
    try { for (const a of e.assets) { try { fs.linkSync(path.join(from,a.file),path.join(dir,a.file)); } catch { fs.copyFileSync(path.join(from,a.file),path.join(dir,a.file)); } } }
    catch(err) { fs.rmSync(dir,{recursive:true,force:true}); throw err; }
    const job = { id, userId:req.user.id, kind:"reel", templateId:e.templateId, editId:e.id, analysisTraceId:e.analysisTraceId||null,renderTraceId:trace.id, conversationSnapshot:{memory:structuredClone(e.dialogue?.memory||null),work:structuredClone(e.work||null),confirmed:e.confirmed,confirmedKey:e.confirmedKey||null},templateData:{ analysis:structuredClone(e.analysis), assets:structuredClone(e.assets) },
      inputs:e.assets.map((a,i)=>({n:i+1,type:a.type,file:a.file,uploaded:true})), frames:[], brief:PRODUCT_TEMPLATE.name,
      status:"queued", revisionOf:e.revisionOf||null, usage:{tokens:0,cost:0}, createdAt:Date.now() };
    db.jobs.push(job); e.jobId=id; e.status="rendering";
    trace.record('render.queued',{jobId:id,revisionOf:job.revisionOf});
    e.messages.push(assistantMessage("ساخت شروع شد؛ می‌تونی از چت خارج بشی.")); save(); enqueue(job); res.status(202).json({ ...view(e),jobId:id });
    } catch(error) { if(preparing&&e.renderPreparationTraceId===trace.id)delete e.renderPreparationTraceId;if(preparing&&e.status==='analyzing'){e.status='error';e.progress=null;e.error='بررسی رسانه کامل نشد؛ دوباره امتحان کن.';save();}trace.record('render.rejected',{error:traceError(error)}); throw error; }
  }));
  // Private evidence previews; neither raw uploads nor transcripts become public assets.
  app.get("/api/edits/:id/assets/:asset", requireMediaUser, wrap(async (req,res) => {
    const e=own(req), a=e.assets.find(a=>a.id===req.params.asset);
    if (!a) throw fail(404,"فایل پیدا نشد.");
    if(e.mediaExpired)throw fail(410,"مهلت فایل خام تمام شده؛ خروجی ویدیو محفوظ است.");
    res.set("Cache-Control","private, no-store");
    res.type(/^(audio|video)\/[\w.+-]+(?:;.*)?$/.test(a.mime) ? a.mime : "application/octet-stream").sendFile(path.join(jobDir(`edit-${e.id}`),a.file));
  }));
  app.get("/api/edits/:id/frames/:frame", requireUser, wrap(async(req,res)=>{
    const e=own(req), f=e.assets.flatMap(a=>a.frames||[]).find(f=>f.id===req.params.frame);
    if(!f) throw fail(404,"تصویر پیدا نشد.");
    res.sendFile(path.join(jobDir(`edit-${e.id}`),f.file));
  }));
}
