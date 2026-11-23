// Template contract: models select evidence; code owns presentation and requirements.
import { z } from "zod";
import {dialogueSchema} from './conversation.js';
import {normalizeAdjustments,ADJUSTMENT_LIMITS} from './adjustments.js';
import {pictureAllocator,pictureError} from './template-picture.js';
import {usablePicture} from './media-evidence.js';
import {assertCaptionEdits,captionPresentation} from './caption-edits.js';

export const PRODUCT_TEMPLATE = Object.freeze({
  id: "product-presenter", version: 1, name: "معرفی محصول",
  description: "چهره، نمایش محصولات، جمع‌بندی؛ با صدای خودت.",
  sample: process.env.PRODUCT_TEMPLATE_SAMPLE_URL || null,
  rules: { width: 720, height: 1280, fps: 30, music: false, effects: false, subtitles: true, maxSeconds: 90,adjustments:ADJUSTMENT_LIMITS },
});
const ids = z.array(z.string().max(60)).max(30).default([]);
export const analysisSchema = z.object({
  opening: ids, closing: ids,
  products: z.array(z.object({id:z.string().max(60).regex(/^[A-Za-z0-9_-]+$/).optional(), name: z.string().trim().min(1).max(60), speech: ids, visuals: ids, visualRanges:z.array(z.object({frameId:z.string().max(60),start:z.number().finite().min(0).max(300),end:z.number().finite().min(0).max(300)})).max(30).optional() })).max(8).refine(ps=>{const values=ps.map(p=>p.id).filter(Boolean);return new Set(values).size===values.length;},'شناسهٔ تکراری بخش'),
  uncertain: z.boolean().default(false),
  corrections: z.array(z.object({id:z.string().max(60),text:z.string().trim().min(1).max(600)})).max(40).default([]),
  captionEdits:z.array(z.object({id:z.string().max(60),text:z.string().trim().min(1).max(600)})).max(200).default([]),
  dialogue:dialogueSchema.optional(),
  adjustments:z.unknown().optional(),
  adjustmentWarnings:z.array(z.string().max(240)).max(20).optional(),
});
export function shortMessage(value, fallback = "پاسخ کامل نشد؛ دوباره امتحان کن.") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  // Never truncate a negation or instruction halfway through: use a complete fallback.
  return text && text.split(" ").length <= 12 ? text : fallback;
}
export const assistantMessage = (text,fallback) => ({ role: "assistant", text: shortMessage(text,fallback), at: Date.now() });

export function validateEvidence(raw, assets,previousAdjustments) {
  const a = analysisSchema.parse(raw);
  const segments = new Map(assets.flatMap(x => (x.segments || []).map(s => [s.id, { ...s, asset: x }])));
  const frames = new Map(assets.flatMap(x => (x.frames || []).map(f => [f.id, { ...f, asset: x }])));
  const spoken = list => [...new Set(list)].filter(id => segments.has(id));
  const videoSpeech = list => spoken(list).filter(id => segments.get(id).asset.type === "video");
  a.opening = videoSpeech(a.opening); a.closing = videoSpeech(a.closing);
  a.products = a.products.map(p => ({ ...p, speech: spoken(p.speech), visuals: [...new Set(p.visuals)].filter(id => frames.has(id)) }));
  a.corrections=a.corrections.filter(c=>segments.has(c.id)&&!segments.get(c.id).userEdited&&!a.captionEdits.some(edit=>edit.id===c.id));
  const normalized=normalizeAdjustments(a.adjustments,assets,previousAdjustments);a.adjustments=normalized.value;
  a.adjustmentWarnings=[...new Set([...(a.adjustmentWarnings||[]),...normalized.warnings])];
  try{templateTimeline(a,assets);}catch(err){if(err.code==='DURATION_LIMIT'&&Object.keys(a.adjustments.speeds).length){a.adjustments.speeds=normalizeAdjustments(undefined,assets,previousAdjustments).value.speeds;a.adjustmentWarnings.push('سرعت درخواستی زمان خروجی رو زیاد می‌کرد؛ اعمال نشد.');}}
  return a;
}

export function requirements(analysis, assets, confirmed = false) {
  const a = analysis || { opening: [], closing: [], products: [] };
  const items = [
    { id: "opening", label: "شروع با چهره", done: !!a.opening.length, prompt: "جلوی دوربین، محصولاتت رو کوتاه معرفی کن.", accepts: "video" },
    ...(!a.products.length ? [{ id: "products", label: "محصول و توضیح", done: false, prompt: "محصولت رو نشان بده و کاربردش رو توضیح بده.", accepts: "video" }] : a.products.flatMap((p, i) => [
      { id: `speech-${i}`, label: `توضیح ${p.name}`, done: !!p.speech.length, prompt: "کاربرد این محصول رو بگو؛ تپق زدی، تکرار کن.", product: p.name, accepts: "audio,video" },
      { id: `visual-${i}`, label: `نمای ${p.name}`, done: !!p.visuals.length, prompt: "همین محصول رو چهار ثانیه ثابت نشان بده.", product: p.name, accepts: "video" },
    ])),
    { id: "closing", label: "پایان با چهره", done: !!a.closing.length, prompt: "جلوی دوربین بگو چطور می‌شه سفارش داد.", accepts: "video" },
  ];
  a.products.forEach((p,i)=>{
    if(!p.speech.length||!p.visuals.length)return;
    try{templateTimeline({...a,opening:[],closing:[],products:[p]},assets);}
    catch(err){if(['VISUAL_COVERAGE','VISUAL_RANGE','SPEECH_SOURCE'].includes(err.code))items.push({id:`coverage-${i}`,label:`پوشش توضیح ${p.name}`,product:p.name,done:false,prompt:err.message,accepts:err.code==='SPEECH_SOURCE'?'audio,video':'video'});}
  });
  if (a.uncertain && !confirmed) items.push({ id: "confirm", label: "تأیید تشخیص محصولات", done: false, prompt: "محصولات و بخش‌های انتخاب‌شده درست تشخیص داده شدن؟", accepts: "confirm" });
  // ASR spelling suggestions are optional advice, never a required input or an auto-applied edit.
  if (analysis && items.every(r=>r.done)) {
    try { templateTimeline(analysis, assets); }
    catch(err) { items.push({ id:"timeline", label:"مدت بخش‌های انتخاب‌شده", done:false, prompt:err.message, accepts:"audio,video" }); }
  }
  return items;
}

// Audio ownership and selected picture ranges remain explicit; no source fallback.
export function templateTimeline(analysis, assets) {
  assertCaptionEdits(analysis.captionEdits,assets);
  const settings=normalizeAdjustments(analysis.adjustments,assets).value;
  const segments=new Map(assets.flatMap(a=>(a.segments||[]).map(s=>[s.id,{...s,asset:a}])));
  const timeline=[],used=new Set();let cursor=0;
  const append=(id,allocate=null)=>{
    if(used.has(id))throw pictureError('DUPLICATE_SPEECH','برای بخش‌های مختلف، گفتار جدا انتخاب کن.');
    const s=segments.get(id);
    if(!s||s.asset.hasAudio===false||s.end<=s.start)throw pictureError('SPEECH_SOURCE','گفتار قابل استفاده برای این بخش انتخاب کن.');
    let start=Math.max(0,Math.floor((s.start-.10)*30)/30);
    const end=Math.min(s.asset.duration,Math.ceil((s.end+.12)*30)/30),previous=timeline.at(-1);
    if(previous?.audioAsset===s.asset.id&&start<previous.sourceOut&&s.start>=previous.sourceIn)start=previous.sourceOut;
    if(end-start<.1)throw pictureError('SPEECH_SOURCE','گفتار این بخش بیش‌ازحد کوتاه است.');
    let pictures;
    if(allocate)pictures=allocate(end-start);
    else {
      if(!usablePicture(s.asset,start,end))throw pictureError('PRESENTER_PICTURE','این بخش به ویدیوی روشنِ چهره نیاز دارد.');
      pictures=[{videoAsset:s.asset.id,videoIn:start,duration:end-start,visualFrameIds:[]}];
    }
    const caption=captionPresentation(analysis,s),speed=settings.speeds[id]||1;let sourceIn=start;
    for(const [index,picture] of pictures.entries()) {
      const duration=picture.duration/speed;
      if(cursor+duration>PRODUCT_TEMPLATE.rules.maxSeconds)throw pictureError('DURATION_LIMIT','توضیحات طولانیه؛ بخش‌های انتخاب‌شده رو کمتر کن.');
      timeline.push({segmentId:id,audioAsset:s.asset.id,videoAsset:picture.videoAsset,sourceIn,sourceOut:sourceIn+picture.duration,videoIn:picture.videoIn,start:cursor,end:cursor+duration,speed,text:s.text,words:s.words||[],captionText:caption.text,captionWords:caption.words,visualFrameIds:picture.visualFrameIds,speechStart:index===0,speechEnd:index===pictures.length-1});
      cursor+=duration;sourceIn+=picture.duration;
    }
    used.add(id);
  };
  analysis.opening.forEach(id=>append(id));
  analysis.products.forEach(product=>{const allocate=pictureAllocator(product,assets);product.speech.forEach(id=>append(id,allocate));});
  analysis.closing.forEach(id=>append(id));
  if(!timeline.length)throw pictureError('SPEECH_SOURCE','هنوز گفتار قابل استفاده نداریم.');
  return timeline;
}
