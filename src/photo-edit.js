import fs from 'node:fs';
import path from 'node:path';
import {newId} from './store.js';
import {jobDir} from './media.js';
import {takeUpload} from './uploads.js';
import {PHOTO_MOTION_TEMPLATE,preparePhoto,renderPhotoScene} from './photo-motion.js';
import {AD_VERSION,designAd,deriveAdLayers,animateAdLayers} from './ad-scene.js';
import {publicJobError} from './user-errors.js';
import {CREATIVE_PROTOCOL} from './ad-grounding.js';

export const isPhotoEdit=e=>e.templateId===PHOTO_MOTION_TEMPLATE.id;
const fail=(status,message)=>Object.assign(new Error(message),{status});
const previewOf=(e,db)=>db.jobs.find(j=>j.id===e.previewJobId&&j.userId===e.userId);
const running=j=>j&&['queued','running'].includes(j.status);
export function photoEditView(e,db={jobs:[]}){
  const p=previewOf(e,db),busy=e.status==='analyzing'||running(p),closed=!!e.archived||!!e.jobId;
  const status=busy?(e.status==='analyzing'?'analyzing':'rendering'):p?.status==='error'?'error':p?.status==='awaiting_input'?'awaiting':e.assets.length?'ready':'awaiting';
  return {id:e.id,templateId:e.templateId,status,archived:!!e.archived,createdAt:e.createdAt,messages:e.messages,assets:e.assets.map(a=>({id:a.id,type:'image',name:a.name})),usage:e.usage,jobId:e.jobId,error:publicJobError({error:e.error})||publicJobError(p),progress:busy?{stage:p?.stage||e.progress?.stage||'queued',startedAt:p?.startedAt||e.progress?.startedAt}:null,requirements:[],segments:[],demo:false,
    preview:p?{id:p.id,status:p.status,video:p.status==='done'?`/api/edits/${e.id}/preview-video?v=${p.id}`:null,question:p.photoQuestion||null,error:publicJobError(p)}:null,
    build:{canBuild:!closed&&!busy&&e.assets.length===1,reason:closed?'closed':busy?'processing':e.assets.length?'ready':'missing-input'},canApprove:!closed&&!busy&&p?.status==='done'};
}
export function accountAdUsage(target,user,event){const u=event.usage;for(const subject of [target,user]){subject.usage??={tokens:0,cost:0};subject.usage.tokens=(subject.usage.tokens||0)+(u?.total_tokens||0);if(Number.isFinite(u?.cost))subject.usage.cost=(subject.usage.cost||0)+u.cost;else subject.usage.unpriced=true;subject.usage.requests=(subject.usage.requests||0)+1;}}

export function photoEditRoutes(app,{db,save,requireUser,wrap,quota,enqueue,mediaCookie,requireMediaUser}){
  const own=req=>{const e=db.edits.find(e=>e.id===req.params.id&&e.userId===req.user.id);if(!e)throw fail(404,'گفت‌وگو پیدا نشد.');return e;};
  const view=e=>photoEditView(e,db);
  const route=fn=>(req,res,next)=>wrap(async()=>{const e=own(req);if(!isPhotoEdit(e))return next();await fn(req,res,e);})(req,res);
  const mutable=e=>{if(e.archived||e.jobId||e.status==='analyzing'||running(previewOf(e,db)))throw fail(409,'این ادیت در حال پردازش یا بسته است.');};
  const beginPreview=(req,e)=>{
    const text=String(req.body.text||'').trim(),requestId=String(req.body.requestId||'');
    if(text.length>1000||requestId&&!/^[\w-]{8,80}$/.test(requestId))throw fail(400,'پیام نامعتبر است.');
    if(requestId&&db.jobs.some(j=>j.editId===e.id&&j.userId===e.userId&&j.photoRequestId===requestId))return;
    const prior=previewOf(e,db);
    if(running(prior)){if(text)throw fail(409,'ساخت پیش‌نمایش هنوز تمام نشده.');return;}
    mutable(e);if(e.assets.length!==1)throw fail(400,'اول یک عکس بفرست.');
    if(!text&&prior?.status==='done')return;
    if(!text&&prior?.status==='error')throw fail(409,'برای ادامه، تلاش دوباره را بزن.');
    if(!text&&prior?.status==='awaiting_input')throw fail(400,'پاسخ سؤال را بنویس.');
    quota(req.user,'reel');const id=newId(),dir=jobDir(id),a=e.assets[0];let previousPlan=null;
    try{fs.copyFileSync(path.join(jobDir(`edit-${e.id}`),a.file),path.join(dir,a.file));
      if(prior){const parentDir=jobDir(prior.id);for(const folder of ['ad-design','ad-assets'])if(fs.existsSync(path.join(parentDir,folder)))fs.cpSync(path.join(parentDir,folder),path.join(dir,folder),{recursive:true});try{previousPlan=JSON.parse(fs.readFileSync(path.join(dir,'ad-design','design.json'),'utf8')).plan;}catch{}}
    }catch(error){fs.rmSync(dir,{recursive:true,force:true});throw error;}
    const brief=[e.adBrief||'',text].filter(Boolean).join('\n').slice(-4000);
    const job={id,userId:e.userId,kind:'reel',isPreview:true,templateId:e.templateId,templateVersion:PHOTO_MOTION_TEMPLATE.version,imageAttempt:newId(),editId:e.id,photoRequestId:requestId||null,revisionOf:prior?.id||null,templateData:{assets:structuredClone(e.assets),adVersion:AD_VERSION,creativeProtocol:CREATIVE_PROTOCOL,brief,previousPlan},inputs:[{n:1,type:'image',file:a.file}],frames:[],brief:PHOTO_MOTION_TEMPLATE.name,status:'queued',usage:{tokens:0,cost:0},createdAt:Date.now()};
    db.jobs.push(job);e.previewJobId=id;e.adBrief=brief;e.status='rendering';e.error=null;
    if(text)e.messages.push({role:'user',text,at:Date.now()});save();enqueue(job);
  };
  app.get('/api/edits/:id',requireUser,route(async(req,res,e)=>{mediaCookie(req,res);res.json(view(e));}));
  app.get('/api/edits/:id/photo',requireMediaUser,route(async(req,res,e)=>{if(!e.assets.length||e.mediaExpired)throw fail(410,'عکس در دسترس نیست.');res.set('Cache-Control','private, no-store').type('image/png').sendFile(path.join(jobDir(`edit-${e.id}`),e.assets[0].file));}));
  app.get('/api/edits/:id/preview-video',requireMediaUser,route(async(req,res,e)=>{const p=previewOf(e,db);if(e.archived||p?.status!=='done'||p.id!==req.query.v)throw fail(404,'پیش‌نمایش پیدا نشد.');res.set('Cache-Control','private, no-store').type('video/mp4').sendFile(path.join(jobDir(p.id),'out.mp4'));}));
  app.post('/api/edits/:id/photo',requireUser,route(async(req,res,e)=>{
    mutable(e);quota(req.user,'reel');const key=String(req.body.upload||'');if(e.photoUpload===key){mediaCookie(req,res);return res.json(view(e));}
    const dir=jobDir(`edit-${e.id}`),id=newId(),raw=path.join(dir,`${id}.raw`),file=`${id}.media`,target=path.join(dir,file);
    try{takeUpload(db,req.user,key,raw);e.status='analyzing';e.progress={stage:'photo_reading',startedAt:Date.now()};save();const dimensions=await preparePhoto(raw,target),previous=e.assets;e.assets=[{id,type:'image',name:String(req.body.name||'عکس محصول').slice(0,100),file,mime:'image/png',...dimensions}];
      e.photoUpload=key;e.status='ready';e.error=null;e.mediaExpired=false;e.previewJobId=null;e.adBrief='';e.messages.push({role:'user',text:'',assetIds:[id],at:Date.now()},{role:'assistant',text:'عکس آماده است؛ پیش‌نمایش موشن را بساز.',at:Date.now()});for(const a of previous)if(/^[\w-]+\.media$/.test(a.file))fs.rmSync(path.join(dir,a.file),{force:true});
    }catch(error){fs.rmSync(target,{force:true});e.status=e.assets.length?'ready':'awaiting';throw error;}finally{fs.rmSync(raw,{force:true});e.progress=null;save();}mediaCookie(req,res);res.json(view(e));
  }));
  app.post(['/api/edits/:id/render','/api/edits/:id/design'],requireUser,route(async(req,res,e)=>{if(e.jobId)return res.json(view(e));beginPreview(req,e);res.status(202).json(view(e));}));
  app.post('/api/edits/:id/approve',requireUser,route(async(req,res,e)=>{if(e.jobId)return res.json(view(e));mutable(e);const p=previewOf(e,db);if(p?.status!=='done')throw fail(400,'اول پیش‌نمایش آماده را ببین.');e.jobId=p.id;p.isPreview=false;e.status='ready';e.messages.push({role:'assistant',text:'خروجی تأیید و ذخیره شد.',at:Date.now()});save();res.json(view(e));}));
  app.post('/api/edits/:id/revise',requireUser,route(async(req,res,e)=>{
    const parent=db.jobs.find(j=>j.id===req.body.jobId&&j.editId===e.id&&j.userId===e.userId&&j.status==='done');if(!parent||parent.templateData?.adVersion!==AD_VERSION)throw fail(400,'یک نسخهٔ آماده انتخاب کن.');
    const current=previewOf(e,db),requestedBrief=[parent.templateData.brief||'',String(req.body.text||'').trim()].filter(Boolean).join('\n').slice(-4000);
    if(!e.jobId&&current?.revisionOf===parent.id&&current.templateData.brief===requestedBrief)return res.json(view(e));
    if(running(current))throw fail(409,'ساخت نسخهٔ فعلی هنوز تمام نشده.');
    const active=db.edits.find(d=>d.userId===e.userId&&!d.jobId&&!d.archived&&d.id!==e.id);if(active)return res.status(409).json({error:'اول ادیت فعلی را تکمیل یا لغو کن.',activeEditId:active.id});if(!String(req.body.text||'').trim())throw fail(400,'اصلاح موردنظر را بنویس.');
    const a=parent.templateData.assets[0],source=path.join(jobDir(parent.id),a.file);if(!fs.existsSync(source))throw fail(410,'مهلت عکس خام تمام شده؛ دوباره بفرست.');
    const previous={jobId:e.jobId,previewJobId:e.previewJobId,archived:e.archived,assets:e.assets,adBrief:e.adBrief};try{e.jobId=null;e.archived=false;e.previewJobId=parent.id;e.assets=structuredClone(parent.templateData.assets);e.adBrief=parent.templateData.brief;fs.copyFileSync(source,path.join(jobDir(`edit-${e.id}`),a.file));beginPreview(req,e);}catch(error){Object.assign(e,previous);throw error;}res.status(202).json(view(e));
  }));
  app.post('/api/edits/:id/discard',requireUser,route(async(req,res,e)=>{mutable(e);if(req.body.confirm!==true)throw fail(400,'لغو ادیت را تأیید کن.');e.archived=true;e.archivedAt=Date.now();for(const j of db.jobs)if(j.editId===e.id&&j.isPreview)j.previewCancelled=true;save();res.json(view(e));}));
}

export async function renderPhotoJob(job,onStage,providers={}){
  const dir=jobDir(job.id),source=path.join(dir,job.templateData.assets[0].file);
  if(job.templateData.adVersion===AD_VERSION){
    const design=await designAd({source,dir:path.join(dir,'ad-design'),attempt:job.imageAttempt||job.id,brief:job.templateData.brief,previous:job.templateData.previousPlan,creativeProtocol:job.templateData.creativeProtocol||2,onStage,...providers});if(design.status==='clarify')throw Object.assign(Error('Product needs clarification'),{needsInput:true,question:design.plan.question});
    const assetsDir=path.join(dir,'ad-assets'),scene=await deriveAdLayers({source,dir:assetsDir,designDir:path.join(dir,'ad-design'),attempt:job.imageAttempt||job.id,onStage,...providers}),result=await animateAdLayers(assetsDir,scene,onStage);
    fs.copyFileSync(path.join(assetsDir,'out.mp4'),path.join(dir,'out.mp4'));fs.copyFileSync(path.join(assetsDir,'cover.jpg'),path.join(dir,'cover.jpg'));fs.rmSync(path.join(assetsDir,'out.mp4'));fs.rmSync(path.join(assetsDir,'cover.jpg'));
    return {output:{duration:result.duration,recipe:'layered-product-ad-v2'},video:`/media/${job.id}/out.mp4`,coverImg:`/media/${job.id}/cover.jpg`};
  }
  const result=await renderPhotoScene(source,dir,onStage);return {output:{duration:result.duration,recipe:'photo-composition-v1'},video:`/media/${job.id}/out.mp4`,coverImg:`/media/${job.id}/cover.jpg`};
}
