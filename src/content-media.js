import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {ffmpegPath} from './ffmpeg-path.js';
import {preparePhoto} from './photo-motion.js';
import crypto from 'node:crypto';
const bad=message=>Object.assign(Error(message),{status:415});
export const VIDEO_REJECTED='این نسخه فقط عکس محصول و صدا می‌پذیرد؛ ویدیو پشتیبانی نمی‌شود.';
// Decode a bounded interval instead of trusting MIME, extension, or duration headers.
export async function inspectContentMedia(file){
  if(fs.statSync(file).size>25*1048576)throw bad('حداکثر حجم فایل ۲۵ مگابایت است.');
  const header=Buffer.alloc(16),fd=fs.openSync(file,'r');fs.readSync(fd,header);fs.closeSync(fd);
  const still=header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||header[0]===255&&header[1]===216||header.toString('ascii',0,4)==='RIFF'&&header.toString('ascii',8,12)==='WEBP';
  if(still){const data=fs.readFileSync(file);if(data.includes(Buffer.from('acTL'))||data.includes(Buffer.from('ANIM')))throw bad('یک عکس ثابت بفرست؛ تصویر متحرک پذیرفته نمی‌شود.');const test=file+'.validate-'+crypto.randomUUID()+'.png';try{await preparePhoto(file,test);}finally{fs.rmSync(test,{force:true});}return {kind:'image'};}
  const log=await new Promise((resolve,reject)=>{
    let text='';const p=spawn(ffmpegPath,['-hide_banner','-i',file,'-t','91','-map','0:a:0','-f','null','-'],{windowsHide:true});
    const timer=setTimeout(()=>{p.kill();reject(bad('فایل خوانده نشد.'));},20000);
    p.stderr.on('data',d=>{text=(text+d).slice(-16000);});p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',code=>{clearTimeout(timer);/Video:/.test(text)?reject(bad(VIDEO_REJECTED)):code===0&&/Audio:/.test(text)?resolve(text):reject(bad('فایل خوانده نشد؛ عکس یا صدای معتبر بفرست.'));});
  });
  const times=[...log.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].map(m=>+m[1]*3600+ +m[2]*60+ +m[3]);
  if(!times.length||Math.max(...times)>90.1)throw bad('صدا باید حداکثر ۹۰ ثانیه باشد.');
  return {kind:'audio',duration:Math.max(...times)};
}
