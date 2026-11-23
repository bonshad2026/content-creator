import fs from "node:fs";
import path from "node:path";
import { ffmpeg, frameAt, jobDir, probe } from "./media.js";
import { templateTimeline } from "./templates.js";
import {normalizeAdjustments} from './adjustments.js';
import {prepareMediaEvidence,inspectMediaEvidence} from './media-evidence.js';

const assTime = t => { const n = Math.round(t * 100); return `${Math.floor(n/360000)}:${String(Math.floor(n/6000)%60).padStart(2,"0")}:${String(Math.floor(n/100)%60).padStart(2,"0")}.${String(n%100).padStart(2,"0")}`; };
const safe = s => String(s).replace(/[{}\\\r\n]/g, " ");
export function templateCaptions(timeline,settings={}) {
  const cues = [];
  const speech=[];
  for(const clip of timeline){const previous=speech.at(-1);if(previous?.segmentId===clip.segmentId&&previous.audioAsset===clip.audioAsset&&Math.abs(previous.sourceOut-clip.sourceIn)<1e-5&&previous.speed===clip.speed){previous.sourceOut=clip.sourceOut;previous.end=clip.end;}else speech.push({...clip});}
  for (const c of speech) {
    const words = (c.captionWords??c.words).filter(w => w.start >= c.sourceIn && w.start < c.sourceOut);
    if (words.length) {
      for (let i = 0; i < words.length; i += 4) {
        const group = words.slice(i, i + 4), end = Math.max(group.at(-1).end, group.at(-1).start + .08);
        cues.push({ start: c.start + (group[0].start - c.sourceIn)/(c.speed||1), end: Math.min(c.end, c.start + (end - c.sourceIn)/(c.speed||1)), text: group.map(w => w.text).join(" ") });
      }
    } else cues.push({ start: c.start, end: c.end, text: c.captionText??c.text }); // honest phrase timing, never synthetic karaoke
  }
  for (let i = 0; i < cues.length - 1; i++) cues[i].end = Math.min(cues[i].end, cues[i+1].start);
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Vazirmatn,${normalizeAdjustments(settings).value.fontSize},&H00FFFFFF,&H00FFFFFF,&H00202020,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1,2,110,110,300,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` + cues.filter(c => c.end > c.start).map(c => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${safe(c.text)}\n`).join("");
}

export async function renderTemplate(job, setStage = () => {},trace=null) {
  const dir = jobDir(job.id), { analysis } = job.templateData,assets=structuredClone(job.templateData.assets);
  setStage('checking_media');await prepareMediaEvidence(assets,dir);
  trace?.record('render.evidence',{assets});
  const settings=normalizeAdjustments(analysis.adjustments,assets).value;
  const timeline = templateTimeline(analysis, assets);
  trace?.record('render.plan',{settings,timeline,captions:templateCaptions(timeline,settings)});
  const byId = new Map(assets.map(a => [a.id, a]));
  setStage("rendering");
  fs.writeFileSync(path.join(dir, "timeline.json"), JSON.stringify(timeline, null, 2));
  fs.writeFileSync(path.join(dir, "template.ass"), templateCaptions(timeline,settings), "utf8");
  const fonts = path.relative(dir, path.resolve("node_modules/vazirmatn/fonts/ttf")).replace(/\\/g, "/");
  // Render bounded parts: no full-resolution multi-input graph competing for RAM.
  for (const [i, c] of timeline.entries()) {
    setStage(`rendering:${i+1}/${timeline.length}`);
    const voice = byId.get(c.audioAsset), picture = byId.get(c.videoAsset), d = c.end - c.start;
    const separate = voice.id !== picture.id;
    const sourceDuration=c.sourceOut-c.sourceIn;
    const args = ["-ss", c.videoIn.toFixed(3),"-t",sourceDuration.toFixed(3), "-i", picture.file];
    if (separate) args.push("-ss", c.sourceIn.toFixed(3),"-t",sourceDuration.toFixed(3), "-i", voice.file);
    args.push("-t", d.toFixed(3), "-map", "0:v:0", "-map", separate ? "1:a:0" : "0:a:0",
      "-vf", `scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=(PTS-STARTPTS)/${c.speed},fps=30,setpts=PTS+${c.start.toFixed(6)}/TB,ass=template.ass:fontsdir=${fonts},setpts=PTS-STARTPTS`,
      "-af", `atempo=${c.speed},aresample=48000${settings.gainDb?`,volume=${settings.gainDb}dB,alimiter=limit=0.95:level=false:latency=true`:''}${c.speechStart?',afade=t=in:d=0.006':''}${c.speechEnd?`,afade=t=out:st=${Math.max(0,d-.006).toFixed(3)}:d=0.006`:''}`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-maxrate", "4M", "-bufsize", "8M", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", "-ac", "2", `part-${i}.mkv`);
    trace?.record('render.command',{segment:i,args});
    await ffmpeg(args, dir);
  }
  fs.writeFileSync(path.join(dir, "parts.txt"), timeline.map((_,i) => `file 'part-${i}.mkv'`).join("\n"));
  // Each video segment is encoded once. Joining copies it; audio is encoded once here.
  const joinArgs=["-f", "concat", "-safe", "0", "-i", "parts.txt", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "out.mp4"];
  trace?.record('render.command',{phase:'joining',args:joinArgs});
  setStage('joining');await ffmpeg(joinArgs, dir);
  const out = path.join(dir, "out.mp4");
  let info;
  try {
    info=await probe(out);
    const finalBytes=fs.statSync(out).size;
    trace?.record('render.output',{info,source:await trace.file(out)});
    if(info.width!==720||info.height!==1280||!info.hasAudio||Math.abs(info.duration-timeline.at(-1).end)>Math.max(.12,timeline.length*2/30))throw Error('زمان یا ترک‌های خروجی با برنامهٔ ادیت تطبیق ندارند.');
    setStage('checking_output');
    const output={id:'output',type:'video',file:'out.mp4',duration:info.duration,hasAudio:false,frames:[]};
    await inspectMediaEvidence(output,dir);trace?.record('render.quality',{black:output.mediaEvidence.black});
    if(output.mediaEvidence.black.some(([start,end])=>end-start>.15))throw Error('تصویر سیاه ناخواسته در خروجی تشخیص داده شد.');
    if(finalBytes>info.duration*650000+2000000)throw Error('فایل خروجی بیش‌ازحد بزرگ شد؛ دوباره تلاش کن.');
  } catch(error) {
    for(const name of ['out.mp4','cover.jpg','thumb.jpg'])fs.rmSync(path.join(dir,name),{force:true});
    throw error;
  }
  setStage('finalizing');await frameAt(out,.2,path.join(dir,'cover.jpg'),720);
  fs.copyFileSync(path.join(dir,'cover.jpg'),path.join(dir,'thumb.jpg'));
  for(let i=0;i<timeline.length;i++)fs.rmSync(path.join(dir,`part-${i}.mkv`),{force:true});
  fs.rmSync(path.join(dir,"parts.txt"),{force:true});
  return { video: `/media/${job.id}/out.mp4`, coverImg: `/media/${job.id}/cover.jpg`, thumb: `/media/${job.id}/thumb.jpg`,
    output: { duration: +info.duration.toFixed(1), recipe: "product-presenter", caption: analysis.products.map(p=>p.name).join("، "), hashtags: [], subtitles: true, tips: [] } };
}
