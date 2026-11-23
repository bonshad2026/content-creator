// Local technical evidence, not recognition of products, faces, or speech meaning.
import path from 'node:path';
import {ffmpegScan,detectSilences} from './media.js';
export const MEDIA_EVIDENCE_VERSION=1;
const clamp=(n,d)=>Math.max(0,Math.min(d,n));
export function intersecting(spans,start,end,tolerance=.035) {
  return (spans||[]).some(([a,b])=>Math.min(end,b)-Math.max(start,a)>tolerance);
}
export function usablePicture(asset,start,end) {
  return asset.type==='video'&&start>=-.001&&end<=asset.duration+.035&&end>start&&!intersecting(asset.mediaEvidence?.black||[],start,end);
}
export function frameWindow(frame,asset) {
  // A legacy frame is a sample, not permission to use every later product in the file.
  const start=frame.start??Math.max(0,(frame.t||0)-1);
  const end=frame.end??Math.min(asset.duration,Number.isFinite(frame.t)?frame.t+1:start+2);
  return {start,end};
}
export function bindFrameWindows(asset) {
  for(const frame of asset.frames||[]) {
    const t=frame.t??frame.start??0,shot=asset.mediaEvidence?.shots.find(s=>t>=s.start&&t<s.end);
    frame.shot=shot?.id||null;
    frame.shotStart=shot?.start??0;frame.shotEnd=shot?.end??asset.duration;
    // Keep legacy sample coverage conservative; wider ranges must be explicitly selected.
    frame.end=Math.min(asset.duration,t+1,frame.shotEnd);
    frame.start=Math.max(frame.start??t-1,frame.shotStart,0);
    frame.usable=usablePicture(asset,frame.start,frame.end);
  }
}
export async function inspectMediaEvidence(asset,dir) {
  if(asset.mediaEvidence?.version===MEDIA_EVIDENCE_VERSION){bindFrameWindows(asset);return;}
  const file=path.join(dir,asset.file),duration=asset.duration;
  let black=[],cuts=[];
  if(asset.type==='video') {
    const log=await ffmpegScan(['-i',file,'-map','0:v:0','-an','-vf',"scale=160:-2,blackdetect=d=0.05:pic_th=0.98:pix_th=0.02,select='gt(scene,0.3)',showinfo",'-fps_mode','vfr','-f','null','-'],/black_start:|pts_time:/,undefined,{strict:true});
    black=[...log.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map(m=>[clamp(+m[1],duration),duration-(+m[2])<.08?duration:clamp(+m[2],duration)]);
    cuts=[...new Set([...log.matchAll(/pts_time:([\d.]+)/g)].map(m=>+m[1]).filter(t=>t>.05&&t<duration-.05))].sort((a,b)=>a-b);
  }
  const boundaries=[...new Set([0,...cuts,...black.flat(),duration])].sort((a,b)=>a-b);
  const shots=boundaries.slice(0,-1).map((start,i)=>({id:`${asset.id}:shot${i}`,start,end:boundaries[i+1]})).filter(s=>s.end-s.start>.05&&!intersecting(black,s.start,s.end));
  // Silence is a local hint. It cannot prove a take is good or the ASR text is correct.
  const silences=asset.hasAudio?await detectSilences(file,-40,.65):[];
  asset.mediaEvidence={version:MEDIA_EVIDENCE_VERSION,black,shots:asset.type==='video'?shots:[],silences:silences.map(([s,e])=>[clamp(s,duration),clamp(e,duration)])};
  bindFrameWindows(asset);
}
export async function prepareMediaEvidence(assets,dir,onProgress=()=>{}) {
  for(const [index,asset] of assets.entries()) {
    onProgress({stage:'checking_media',current:index+1,total:assets.length});
    await inspectMediaEvidence(asset,dir);
    for(const segment of asset.segments||[])segment.timingStatus??=speechTakes([segment])[0].timingStatus;
  }
}

const canonical=s=>String(s).normalize('NFKC').replace(/[يك]/g,c=>c==='ي'?'ی':'ک').replace(/[\p{P}\p{Z}\s\u200c\u200d]/gu,'');
export function speechTakes(segments,silences=[]) {
  return segments.flatMap((segment,parent)=>{
    const words=segment.words||[];
    const accurate=words.length&&words.every((w,i)=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start&&w.start>=segment.start-.1&&w.end<=segment.end+.1&&(!i||w.start>=words[i-1].end-.04)&&w.end-w.start<2.5)&&canonical(words.map(w=>w.text).join(' '))===canonical(segment.text);
    if(!accurate)return [{...segment,timingStatus:words.length?'uncertain':'unavailable',sourceSegment:parent}];
    const groups=[[]];
    for(const word of words) {
      const previous=groups.at(-1).at(-1);
      if(previous&&word.start-previous.end>=.65&&silences.some(([a,b])=>a>=previous.end-.1&&b<=word.start+.1&&b-a>=.65))groups.push([]);
      groups.at(-1).push(word);
    }
    if(groups.length===1)return [{...segment,timingStatus:'aligned',sourceSegment:parent}];
    return groups.map((own,take)=>({...segment,start:own[0].start,end:own.at(-1).end,text:own.map(w=>w.text).join(' '),words:own,timingStatus:'aligned',sourceSegment:parent,take}));
  });
}
