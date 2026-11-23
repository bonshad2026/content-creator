// General photo-composition capability. No provider calls and no invented product pixels.
// A template chooses the scene; other templates can reuse the normalized photo/layers.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ffmpegPath} from './ffmpeg-path.js';
import {probe} from './media.js';

export const PHOTO_MOTION_TEMPLATE={id:'photo-motion',version:3,name:'موشن تک‌عکس',description:'روتوش محصول، معرفی مرحله‌ای و موشن ۶ ثانیه‌ای متناسب با عکس محصول.',capabilities:['layered-product-ad','grounded-art-direction','choreographed-motion'],experimental:true,output:'video',duration:6};
const bad=message=>Object.assign(new Error(message),{status:400});
function run(args,cwd){return new Promise((resolve,reject)=>{
  const p=spawn(ffmpegPath,['-hide_banner','-y','-threads','2',...args],{cwd,windowsHide:true});let log='';
  const timer=setTimeout(()=>{p.kill();reject(Error('پردازش عکس بیش از حد طول کشید.'));},120000);
  p.stderr.on('data',d=>{log=(log+d).slice(-5000);});p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',code=>{clearTimeout(timer);code===0?resolve(log):reject(Error('ffmpeg photo: '+log.slice(-900)));});
});}
// Inspect decoded content, never trust its filename/MIME. Reject videos, animations,
// extreme dimensions and undecodable formats before allocating full-size layers.
export async function preparePhoto(input,output){
  if(fs.statSync(input).size>25*1024*1024)throw bad('حداکثر حجم عکس ۲۵ مگابایت است.');
  const data=fs.readFileSync(input),png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=data[0]===255&&data[1]===216;
  const webp=data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
  if(!png&&!jpeg&&!webp)throw bad('عکس JPG، PNG یا WebP بفرست.');
  if((png&&data.includes(Buffer.from('acTL')))||(webp&&data.includes(Buffer.from('ANIM'))))throw bad('یک عکس ثابت بفرست.');
  const header=await new Promise((resolve,reject)=>{const p=spawn(ffmpegPath,['-hide_banner','-max_pixels','24000000','-i',input],{windowsHide:true});let s='';const timer=setTimeout(()=>{p.kill();reject(bad('عکس خوانده نشد.'));},10000);p.stderr.on('data',d=>{s=(s+d).slice(-12000);});p.on('error',reject);p.on('close',()=>{clearTimeout(timer);resolve(s);});});
  const dimensions=/Video:.*?\b(\d{2,5})x(\d{2,5})\b/.exec(header);
  if(!dimensions||+dimensions[1]*+dimensions[2]>24000000||Math.min(+dimensions[1],+dimensions[2])<64||Math.max(+dimensions[1],+dimensions[2])>10000)throw bad('ابعاد عکس مناسب نیست؛ عکس کوچک‌تر بفرست.');
  try{await run(['-max_pixels','24000000','-i',input,'-vf',"scale=1600:1600:force_original_aspect_ratio=decrease,setsar=1",'-frames:v','1','-c:v','png','-f','image2','-update','1',output]);}catch{throw bad('این عکس خوانده نشد؛ با فرمت JPG بفرست.');}
  return {width:+dimensions[1],height:+dimensions[2]};
}

export function photoScene(){return {version:1,capability:'photo-composition',width:720,height:1280,fps:30,duration:6,
  layers:[{id:'background',file:'background.png',role:'backdrop',motion:'slow-drift'},{id:'graphics',file:'graphics.png',role:'decoration',motion:'float'},{id:'photo',file:'photo-layer.png',role:'original-photo',motion:'reveal-and-float'}],
  audio:false,productPixels:'original',segmented:false};}

async function graphics(dir){
  // Transparent graphic layer: two orbital arcs and small accent marks.
  const w=720,h=1280,b=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const dx=x-360,dy=y-640,r=Math.hypot(dx,dy),angle=Math.atan2(dy,dx),arc=(Math.abs(r-306)<1.5&&angle<1.1)||(Math.abs(r-330)<.8&&angle>-.6);
    const spark=(Math.abs(x-81)<2&&Math.abs(y-289)<12)||(Math.abs(x-81)<12&&Math.abs(y-289)<2)||(Math.abs(x-641)<2&&Math.abs(y-1001)<10)||(Math.abs(x-641)<10&&Math.abs(y-1001)<2);
    if(arc||spark){const i=(y*w+x)*4;b[i]=162;b[i+1]=229;b[i+2]=219;b[i+3]=spark?220:100;}
  }
  const raw=path.join(dir,'graphics.rgba');fs.writeFileSync(raw,b);
  try{await run(['-f','rawvideo','-pixel_format','rgba','-video_size',`${w}x${h}`,'-i',raw,'-frames:v','1','-update','1','graphics.png'],dir);}finally{fs.rmSync(raw,{force:true});}
}

export async function composePhotoLayers(source,dir,onStage=()=>{}){
  fs.mkdirSync(dir,{recursive:true});const scene=photoScene();
  onStage('photo_layers');
  await run(['-i',source,'-vf',"scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,gblur=sigma=50,eq=brightness=-0.24:saturation=0.65",'-frames:v','1','-update','1','background.png'],dir);
  await run(['-i',source,'-vf',"scale=540:790:force_original_aspect_ratio=decrease,pad=580:830:(ow-iw)/2:(oh-ih)/2:color=0xf2f5f2,setsar=1",'-frames:v','1','-update','1','photo-layer.png'],dir);
  await graphics(dir);fs.writeFileSync(path.join(dir,'scene.json'),JSON.stringify(scene,null,2));
  return scene;
}

export async function renderPhotoScene(source,dir,onStage=()=>{}){
  const scene=await composePhotoLayers(source,dir,onStage);
  onStage('photo_animating');
  const graph=[
    "[0:v]scale=760:1350,crop=720:1280:x='20+12*sin(t*.45)':y='35+12*cos(t*.4)',setsar=1[bg]",
    "[bg][1:v]overlay=x=0:y='10*sin(t*.8)':shortest=1[decor]",
    "[2:v]scale=1160:1660,zoompan=z='1+0.035*min(on/30,1)+0.008*sin(on/40)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=580x830:fps=30[photo]",
    "[decor][photo]overlay=x='(W-w)/2':y='(H-h)/2+9*sin(t*1.2)+100*pow(max(0,1-t/0.8),3)':shortest=1,fade=t=in:st=0:d=0.3,fade=t=out:st=5.65:d=0.35,format=yuv420p[out]"
  ].join(';');
  const out=path.join(dir,'out.mp4');
  try{
    await run(['-loop','1','-framerate','30','-i','background.png','-loop','1','-framerate','30','-i','graphics.png','-loop','1','-framerate','30','-i','photo-layer.png','-filter_complex_threads','1','-filter_complex',graph,'-map','[out]','-an','-t','6','-c:v','libx264','-threads','2','-preset','fast','-crf','22','-maxrate','3500k','-bufsize','7000k','-movflags','+faststart',out],dir);
    onStage('finalizing');const meta=await probe(out);
    if(meta.width!==720||meta.height!==1280||Math.abs(meta.duration-6)>.12||fs.statSync(out).size>5*1024*1024)throw Error('خروجی موشن تأیید نشد.');
    await run(['-ss','2','-i',out,'-frames:v','1','-update','1','cover.jpg'],dir);
    return {duration:meta.duration,width:meta.width,height:meta.height,scene};
  }catch(error){fs.rmSync(out,{force:true});throw error;}
}
