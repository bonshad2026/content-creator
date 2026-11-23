// GapGPT reference-image editing capability. Explicit calls only; no SDK retries.
// An exclusive receipt prevents an interrupted request from silently spending again.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {spawn} from 'node:child_process';
import {ffmpegPath} from './ffmpeg-path.js';

const MAX=35*1024*1024;
export async function inspectImageAsset(file){
  const header=fs.readFileSync(file).subarray(0,26);
  if(!header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Image asset must be PNG');
  const width=header.readUInt32BE(16),height=header.readUInt32BE(20);
  if(!width||!height||width*height>24000000)throw Error('Image asset dimensions exceed limit');
  return new Promise((resolve,reject)=>{
    let count=0,transparent=0,partial=0,solid=0,x0=width,y0=height,x1=-1,y1=-1,log='';
    const p=spawn(ffmpegPath,['-hide_banner','-max_pixels','24000000','-i',file,'-vf','format=rgba,alphaextract','-frames:v','1','-f','rawvideo','-pix_fmt','gray','pipe:1'],{windowsHide:true});
    const timer=setTimeout(()=>p.kill(),15000);
    p.stdout.on('data',bytes=>{for(const a of bytes){const x=count%width,y=Math.floor(count/width);if(a===0)transparent++;else {if(a===255)solid++;else partial++;if(a>8){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}count++;}});
    p.stderr.on('data',bytes=>{log=(log+bytes).slice(-500);});
    p.on('error',e=>{clearTimeout(timer);reject(e);});
    p.on('close',code=>{clearTimeout(timer);if(code!==0||count!==width*height)return reject(Error('PNG alpha decode failed: '+log));resolve({width,height,pixels:count,transparentFraction:transparent/count,partialAlphaFraction:partial/count,solidFraction:solid/count,bounds:x1<0?null:{left:x0,top:y0,right:x1,bottom:y1},hasMeaningfulTransparency:transparent/count>.02&&(partial+solid)/count>.005});});
  });
}
const blocked=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(ip,bits,'ipv4');
async function fetchPublicImage(value,redirects=0,addressIndex=0){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||isIP(url.hostname.replace(/^\[|\]$/g,''))||redirects>3)throw Error('Unsafe image output URL');
  const addresses=await lookup(url.hostname,{family:4,all:true});
  if(!addresses.length||addresses.some(a=>blocked.check(a.address,'ipv4')))throw Error('Private image output address');
  return new Promise((resolve,reject)=>{
    // Pin the validated address; never forward the GapGPT credential to a CDN.
    const address=addresses[addressIndex%addresses.length];
    const req=https.get(url,{lookup:(host,options,cb)=>options.all?cb(null,[address]):cb(null,address.address,4)},res=>{
      if([301,302,303,307,308].includes(res.statusCode)){res.resume();fetchPublicImage(new URL(res.headers.location,url).href,redirects+1,addressIndex).then(resolve,reject);return;}
      if(res.statusCode!==200){res.resume();reject(Object.assign(Error('Image download failed: '+res.statusCode),{status:res.statusCode}));return;}
      let size=0;const chunks=[];res.on('data',c=>{size+=c.length;if(size>MAX){res.destroy();reject(Error('Generated image too large'));}else chunks.push(c);});res.on('end',()=>resolve(Buffer.concat(chunks)));res.on('error',reject);
    });const timeout=()=>req.destroy(Object.assign(Error('Image download timed out'),{code:'ETIMEDOUT'}));const deadline=setTimeout(timeout,120000);req.once('close',()=>clearTimeout(deadline));req.setTimeout(30000,timeout);req.on('error',reject);
  });
}
export async function downloadImageAsset(value){
  for(let attempt=0;attempt<2;attempt++)try{return await fetchPublicImage(value,0,attempt);}catch(error){
    const transient=['ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENETUNREACH','EAI_AGAIN'].includes(error.code)||error.status>=500;
    if(!transient||attempt===1)throw error;
  }
}

export async function editImageAsset({inputs,prompt,output,transparent=true,size='1024x1536',model=process.env.GAPGPT_IMAGE_MODEL||'gpt-image-2.6-sunburst',download=downloadImageAsset,onGeneration=()=>{}}){
  if(!process.env.GAPGPT_API_KEY)throw Error('GapGPT image key is missing');
  if(!Array.isArray(inputs)||!inputs.length||inputs.length>4)throw Error('Reference images are required');
  if(fs.existsSync(output))throw Error('Image output already exists; refusing a duplicate charge');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const receipt=output+'.request.json';
  const record={version:1,model,prompt,transparent,size,inputs:inputs.map(p=>({name:path.basename(p),sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')})),status:'requesting',startedAt:Date.now()};
  const base=(process.env.GAPGPT_BASE_URL||'https://api.gapgpt.app/v1').replace(/\/$/,'');
  record.goalHash=crypto.createHash('sha256').update(JSON.stringify({base,model,prompt,transparent,size:record.size,inputs:record.inputs.map(i=>i.sha256)})).digest('hex');
  fs.writeFileSync(receipt,JSON.stringify(record,null,2),{flag:'wx'});
  try{
    let saved;
    for(const name of fs.readdirSync(path.dirname(output)).filter(n=>n.endsWith('.request.json')).reverse()){
      try{const r=JSON.parse(fs.readFileSync(path.join(path.dirname(output),name),'utf8'));if(r.goalHash===record.goalHash&&r.assetUrl&&r.phase==='download'&&!r.expired){saved={...r,name};break;}}catch{}
    }
    let body,item;
    if(saved){item={url:saved.assetUrl};record.reusedFrom=saved.name;record.generated=false;record.usage=null;}
    else{
    const form=new FormData();
    for(const [key,value] of Object.entries({model,prompt,n:'1',size:record.size,quality:'high',background:transparent?'transparent':'opaque',output_format:'png'}))form.set(key,value);
    for(const file of inputs)form.append('image[]',new Blob([fs.readFileSync(file)],{type:'image/png'}),path.parse(file).name+'.png');
    const response=await fetch(base+'/images/edits',{method:'POST',headers:{Authorization:'Bearer '+process.env.GAPGPT_API_KEY},body:form,signal:AbortSignal.timeout(300000)});
    record.httpStatus=response.status;
    if(!response.ok){let code='';try{const b=await response.json();code=b.error?.code||b.code||b.error?.type||'';}catch{}record.providerCode=String(code).slice(0,120);throw Object.assign(Error(`GapGPT image edit failed (${response.status}${code?': '+code:''})`),{code:String(code)});}
    body=await response.json();item=body.data?.[0];record.generated=true;record.usage=body.usage||null;onGeneration(record.usage);
    }
    let bytes;if(item?.b64_json){if(item.b64_json.length>MAX*1.4)throw Error('Generated image too large');bytes=Buffer.from(item.b64_json,'base64');record.delivery='base64';}
    else if(item?.url){
      record.assetUrl=item.url;record.phase='download';record.delivery='url';record.status='download_pending';
      // Persist the successful provider response BEFORE fetching its CDN output.
      fs.writeFileSync(receipt,JSON.stringify(record,null,2));
      try{bytes=await download(item.url);}
      catch(error){throw Object.assign(error,{code:'AD_ASSET_DOWNLOAD_FAILED',publicMessage:'دریافت فایل کامل نشد؛ دوباره امتحان کن.'});}
    }
    else throw Error('GapGPT returned no image');
    record.phase='validation';
    const signature=Buffer.from([137,80,78,71,13,10,26,10]);
    if(!bytes.subarray(0,8).equals(signature))throw Error('GapGPT did not return a PNG');
    fs.writeFileSync(output,bytes,{flag:'wx'});
    record.alpha=await inspectImageAsset(output);
    if(transparent&&!record.alpha.hasMeaningfulTransparency)throw Error('GapGPT returned an image without usable alpha transparency');
    Object.assign(record,{status:'received',finishedAt:Date.now(),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),providerCreated:body?.created||null});
    fs.writeFileSync(receipt,JSON.stringify(record,null,2));
    return {output,bytes:bytes.length,usage:record.usage,generated:record.generated};
  }catch(error){record.status='failed';record.finishedAt=Date.now();record.error=error.message;fs.writeFileSync(receipt,JSON.stringify(record,null,2));throw error;}
}
