// Only black pixels and alpha from the subject: no generated objects/reflections.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ffmpeg} from './media.js';
import {inspectImageAsset} from './image-assets.js';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
// The compositor owns framing. A provider's approximate master coordinates are
// not a reliable floor anchor, especially for an ensemble of several objects.
export async function placeSubject(subject,dir){
  const info=await inspectImageAsset(subject),b=info.bounds;
  if(!b||b.right<b.left||b.bottom<b.top)throw Error('Subject has no visible geometry');
  const scale=Math.min(1,800/(b.right-b.left+1),1100/(b.bottom-b.top+1));
  const width=Math.round(info.width*scale),height=Math.round(info.height*scale);
  const x=Math.round(512-(b.left+b.right)*scale/2),y=Math.round(1320-b.bottom*scale);
  const fingerprint=hash(Buffer.concat([Buffer.from('subject-floor-v1'),fs.readFileSync(subject)])),file=`subject-floor-${fingerprint.slice(0,16)}.png`,output=path.join(dir,file);
  if(!fs.existsSync(output)){
    const temporary=path.join(dir,`${file}.tmp.png`);
    try{
      await ffmpeg(['-i',subject,'-filter_complex_threads','1','-filter_complex',`[0:v]scale=${width}:${height},format=rgba[s];color=black@0:s=1024x1536,format=rgba[b];[b][s]overlay=${x}:${y}:format=auto:shortest=1[out]`,'-map','[out]','-frames:v','1','-update','1',temporary]);
      fs.renameSync(temporary,output);
    }finally{fs.rmSync(temporary,{force:true});}
  }
  return {file,output,hash:hash(fs.readFileSync(output).toString('base64')),alpha:await inspectImageAsset(output),placement:{x,y,scale,floorY:1320}};
}
export function contactPixels(alpha,width,height){
  if(alpha.length!==width*height)throw Error('Invalid subject mask');
  const seen=new Uint8Array(alpha.length),queue=new Int32Array(alpha.length),out=Buffer.alloc(alpha.length*4);
  for(let seed=0;seed<alpha.length;seed++){
    if(seen[seed]||alpha[seed]<32)continue;
    let count=1;queue[0]=seed;seen[seed]=1;let left=width,right=0,top=height,bottom=0;
    for(let n=0;n<count;n++){
      const p=queue[n],x=p%width,y=Math.floor(p/width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      for(const q of [x>0?p-1:-1,x<width-1?p+1:-1,y>0?p-width:-1,y<height-1?p+width:-1])if(q>=0&&!seen[q]&&alpha[q]>=32){seen[q]=1;queue[count++]=q;}
    }
    if(count<Math.max(16,alpha.length*.0005))continue;
    const band=Math.max(2,Math.round((bottom-top+1)*.12)),foot=new Float32Array(right-left+1);
    for(let n=0;n<count;n++){const p=queue[n];if(Math.floor(p/width)>=bottom-band)foot[p%width-left]+=alpha[p]/255;}
    const peak=Math.max(...foot);if(!peak)continue;
    const radius=Math.max(3,Math.round(height*.012)),sigma=radius/2;
    for(let x=left;x<=right;x++)for(let y=Math.max(0,bottom-radius);y<=Math.min(height-1,bottom+radius);y++){
      const value=Math.round(85*Math.min(1,foot[x-left]/peak)*Math.exp(-.5*((y-bottom)/sigma)**2)),i=(y*width+x)*4+3;
      out[i]=Math.max(out[i],value);
    }
  }
  if(!out.some((v,i)=>i%4===3&&v))throw Error('Subject has no usable contact footprint');
  return out;
}
export async function deriveContact(subject,dir){
  const fingerprint=hash(Buffer.concat([Buffer.from('mask-contact-v1'),fs.readFileSync(subject)])),file=`contact-local-${fingerprint.slice(0,16)}.png`,output=path.join(dir,file);
  if(!fs.existsSync(output)){
    const info=await inspectImageAsset(subject),raw=path.join(dir,`${file}.alpha.raw`),rgba=path.join(dir,`${file}.rgba.raw`),temporary=path.join(dir,`${file}.tmp.png`);
    try{
      await ffmpeg(['-i',subject,'-vf','format=rgba,alphaextract','-frames:v','1','-f','rawvideo','-pix_fmt','gray',raw]);
      fs.writeFileSync(rgba,contactPixels(fs.readFileSync(raw),info.width,info.height));
      await ffmpeg(['-f','rawvideo','-pixel_format','rgba','-video_size',`${info.width}x${info.height}`,'-i',rgba,'-vf','gblur=sigma=5','-frames:v','1','-update','1',temporary]);
      fs.renameSync(temporary,output);
    }finally{for(const f of [raw,rgba,temporary])fs.rmSync(f,{force:true});}
  }
  return {file,output,hash:hash(fs.readFileSync(output).toString('base64')),alpha:await inspectImageAsset(output),derivedFrom:'subject-alpha-v1'};
}
