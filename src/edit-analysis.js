import fs from "node:fs";
import path from "node:path";
import {createHash} from 'node:crypto';
import { probe, ffmpeg, frameAt, extractAudio } from "./media.js";
import { transcribe, inspectTemplate, demoMode } from "./ai.js";
import { analysisSchema } from "./templates.js";
import {templateContext} from './template-conversation.js';
import {inspectMediaEvidence,speechTakes,bindFrameWindows} from './media-evidence.js';

function wavPeaks(file){
  const wav=fs.readFileSync(file);let offset=12,size=0;
  while(offset+8<wav.length){size=wav.readUInt32LE(offset+4);if(wav.toString("ascii",offset,offset+4)==="data"){offset+=8;break;}offset+=8+size+(size%2);}
  const samples=Math.min(size,Math.max(0,wav.length-offset))/2,peaks=[];
  for(let i=0;i<48;i++){let peak=0;for(let s=Math.floor(i*samples/48);s<Math.floor((i+1)*samples/48);s+=8)peak=Math.max(peak,Math.abs(wav.readInt16LE(offset+s*2))/32768);peaks.push(peak);}
  const max=Math.max(.01,...peaks);return peaks.map(p=>+(p/max).toFixed(3));
}

export async function inspectAsset(asset, dir,onProgress=()=>{},trace=null) {
  if (asset.inspected && (demoMode || asset.inspectionMode === "real")) {
    if(asset.mediaEvidence?.version!==1){onProgress('checking_media');await inspectMediaEvidence(asset,dir);trace?.record('media.profiled',{asset});}
    for(const segment of asset.segments||[])segment.timingStatus??=speechTakes([segment])[0].timingStatus;
    trace?.record('media.reused', {asset});
    return { tokens: 0, cost: 0 };
  }
  const file = path.join(dir, asset.file);
  onProgress('reading_media');
  trace?.record('media.inspecting', {assetId:asset.id, source:await trace.file(file)});
  let info;
  if (asset.type === "audio") {
    onProgress('extracting_audio');
    // probe() requires video. Decode to a bounded WAV and measure the sample duration locally.
    await ffmpeg(["-i", file, "-vn", "-ac", "1", "-ar", "16000", "-t", "301", "-c:a", "pcm_s16le", `${asset.id}.wav`], dir);
    const wav = fs.readFileSync(path.join(dir, `${asset.id}.wav`));
    let data = 0;
    for (let at = 12; at + 8 <= wav.length;) { const size = wav.readUInt32LE(at + 4); if (wav.toString("ascii", at, at + 4) === "data") { data = size; break; } at += 8 + size + size % 2; }
    info = { duration: data / 32000, hasAudio: true };
  } else info = await probe(file);
  if (!info.duration || info.duration > 300) throw Object.assign(new Error("هر فایل باید کمتر از پنج دقیقه باشه."), { status: 400 });
  Object.assign(asset, info); asset.frames = [];
  onProgress('checking_media');await inspectMediaEvidence(asset,dir);
  if(asset.type==="audio")asset.waveform=wavPeaks(path.join(dir,`${asset.id}.wav`));
  if (asset.type === "video") {
    onProgress('extracting_frames');
    const count = Math.min(24, Math.max(2, Math.ceil(info.duration / 3)));
    for (let i = 0; i < count; i++) {
      const t = Math.min(info.duration - .1, (i + .5) * info.duration / count);
      const name = `${asset.id}-f${i}.jpg`;
      await frameAt(file, t, path.join(dir, name));
      asset.frames.push({ id: `${asset.id}:f${i}`, start: Math.max(0, t - 1), t, file: name });
    }
  }
  let usage = { tokens: 0, cost: 0 }; asset.segments = [];
  if (info.hasAudio && !demoMode) {
    const speechFile=path.join(dir,`${asset.id}.wav`);
    onProgress('extracting_audio');
    if(asset.type!=="audio")await ffmpeg(["-i",file,"-vn","-ac","1","-ar","16000","-c:a","pcm_s16le",speechFile]);
    onProgress('transcribing');const r = await transcribe(speechFile, "fa", trace);
    asset.sourceSegments=r.segments;
    asset.segments = speechTakes(r.segments.filter(s => s.noSpeech < .6 && s.end > s.start && s.start < info.duration)
      .map(s=>({...s,end:Math.min(s.end,info.duration)})),asset.mediaEvidence.silences)
      .map((s,i)=>({...s,id:`${asset.id}:s${i}`}));
    usage = { tokens: r.tokens || 0, cost: r.cost || 0 };
  }
  asset.inspected = true; asset.inspectionMode=demoMode?"demo":"real";
  bindFrameWindows(asset);
  trace?.record('media.inspected', {asset});
  return usage;
}

export async function analyzeEdit(edit, dir, onUsage = () => {},onProgress=()=>{},trace=null) {
  for (const [i,asset] of edit.assets.entries()) {
    const u = await inspectAsset(asset, dir,stage=>onProgress({stage,current:i+1,total:edit.assets.length}),trace); onUsage(u);
  }
  if (demoMode) {
    trace?.record('analysis.demo', {});
    // Demo never certifies speech or content it hasn't inspected.
    return { opening: [], closing: [], products: [], uncertain: false };
  }
  const context=templateContext(edit),fingerprint=createHash('sha256').update(JSON.stringify({protocol:5,context,evidence:edit.assets.map(a=>({id:a.id,segments:a.segments,frames:a.frames,mediaEvidence:a.mediaEvidence}))})).digest('hex');
  trace?.record('analysis.context', {context, fingerprint});
  let data;
  if(edit.analysisCache?.fingerprint===fingerprint){
    data=edit.analysisCache.data;
    trace?.record('analysis.cache_hit', {fingerprint, sourceTraceId:edit.analysisCache.traceId||null, data});
  } else {
    onProgress({stage:'understanding_request'});
    const r=await inspectTemplate(edit.assets,context,dir,trace);data=r.data;
    edit.analysisCache={fingerprint,data,...(trace?.id?{traceId:trace.id}:{})};onUsage(r.usage);
  }
  onProgress({stage:'validating_changes'});
  if(!data.dialogue)throw Error('پاسخ مدل فاقد تصمیم مکالمه است.');
  const result=analysisSchema.parse(data);
  trace?.record('analysis.normalized', {data:result});
  return result;
}
