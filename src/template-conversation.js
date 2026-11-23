// Adapter: only this module knows the active template's selection structure.
import {templateTimeline,PRODUCT_TEMPLATE} from './templates.js';
import {conversationContext} from './conversation.js';
import {normalizeAdjustments,ADJUSTMENT_LIMITS} from './adjustments.js';
import {captionText} from './caption-edits.js';
export const templateFingerprint=(analysis,assets,timeline=templateTimeline(analysis,assets))=>JSON.stringify({timeline:timeline.map(c=>Object.fromEntries(['segmentId','audioAsset','videoAsset','sourceIn','sourceOut','videoIn','start','end','speed','captionText','captionWords'].map(key=>[key,key==='speed'?(c[key]||1):key==='captionText'?(c.captionText??c.text):key==='captionWords'?(c.captionWords??c.words):c[key]]))),caption:analysis.products.map(p=>p.name),adjustments:normalizeAdjustments(analysis.adjustments,assets).value});
export function templateTargets(analysis,assets){
  const settings=normalizeAdjustments(analysis?.adjustments,assets).value;
  const parameters=[{id:'adjustments/fontSize',label:'اندازهٔ زیرنویس',value:settings.fontSize,refs:[],assetIds:[],selectable:false},{id:'adjustments/gainDb',label:'بلندی صدا',value:settings.gainDb,refs:[],assetIds:[],selectable:false},{id:'adjustments/speeds',label:'سرعت بخش‌ها',value:settings.speeds,refs:[],assetIds:[],selectable:false},...assets.flatMap(a=>(a.segments||[]).map(s=>({id:`adjustments/speeds/${s.id}`,label:`سرعت: ${String(s.text||'گفتار').slice(0,60)}`,value:settings.speeds[s.id]||1,refs:[],assetIds:[],selectable:false})))];
  analysis||={opening:[],closing:[],products:[]};
  const ownership=new Map(assets.flatMap(a=>[...(a.segments||[]),...(a.frames||[])].map(r=>[r.id,a.id])));
  const target=(id,label,refs)=>({id,label,refs:[...refs],assetIds:[...new Set(refs.map(r=>ownership.get(r)).filter(Boolean))]});
  const selected=new Set([...analysis.opening,...analysis.closing,...analysis.products.flatMap(p=>p.speech)]);
  const captions=assets.flatMap(a=>(a.segments||[]).filter(s=>selected.has(s.id)).map(s=>({id:`captions/${s.id}`,label:`زیرنویس: ${String(captionText(analysis,s)||'').slice(0,60)}`,value:captionText(analysis,s),refs:[],assetIds:[],selectable:false})));
  return [target('opening','شروع',analysis.opening),{...target('products','محصولات',analysis.products.flatMap(p=>[...p.speech,...p.visuals])),value:analysis.products.map((p,i)=>({id:p.id||`product-${i}`,name:p.name})),selectable:false},{id:'sequence/products',label:'ترتیب محصولات',value:analysis.products.map((p,i)=>p.id||`product-${i}`),refs:[],assetIds:[],selectable:false},...analysis.products.flatMap((p,i)=>[
    {...target(`products/${p.id||`product-${i}`}`,p.name,[...p.speech,...p.visuals]),value:p.visualRanges||[]},target(`products/${p.id||`product-${i}`}/speech`,`گفتار ${p.name}`,p.speech),{...target(`products/${p.id||`product-${i}`}/visuals`,`تصویر ${p.name}`,p.visuals),value:p.visualRanges||[]},{id:`products/${p.id||`product-${i}`}/name`,label:`نام ${p.name}`,value:p.name,refs:[],assetIds:[],selectable:false},
  ]),target('closing','پایان',analysis.closing),...captions,...parameters];
}
export function templateContext(edit){
  let timeline=[];try{timeline=templateTimeline(edit.analysis,edit.assets).map(c=>({segmentId:c.segmentId,start:c.start,end:c.end,videoAsset:c.videoAsset}));}catch{}
  const state=edit.analysis?{...edit.analysis,adjustments:normalizeAdjustments(edit.analysis.adjustments,edit.assets).value,products:edit.analysis.products.map((p,i)=>({...p,id:p.id||`product-${i}`}))}:null;
  return {...conversationContext(edit,{state,targets:templateTargets(edit.analysis,edit.assets),capabilities:{template:PRODUCT_TEMPLATE.id,selectSpeech:true,selectProductFootage:true,replaceEvidence:true,suggestTranscriptCorrections:true,correctCaptionText:true,captionTargets:'captions/<segmentId>, update with assetIds:[] and captionEdits:[{id:segmentId,text:complete corrected caption}]; remove restores original ASR text. Spoken audio stays unchanged.',adjustments:ADJUSTMENT_LIMITS,adjustmentTargets:'fontSize and gainDb are global; speeds is a map from actual segment IDs to speed. Other sizes are not currently adjustable.',synthesizeSpeech:false,music:false,effects:false},versions:edit.revisionBaseline?[edit.revisionBaseline]:[]}),execution:{protocol:5,mode:edit.analysis?'patch':'initial',onlyDeclaredTargets:true,proposalValues:'returned evidence, captionEdits and adjustment fields',collectionTarget:'products',orderTarget:'sequence/products'},timeline};
}
