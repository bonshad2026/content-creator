import {api,getToken,rel} from './api';
import type {SendProgress} from './types';
const CHUNK=4*1024*1024;
export const aborted=()=>new DOMException('ارسال لغو شد.','AbortError');
export function readBlob(blob:Blob,signal:AbortSignal,timeout=20000):Promise<ArrayBuffer>{return new Promise((resolve,reject)=>{
  let reader:FileReader|undefined,done=false;
  const finish=(error:unknown,value?:ArrayBuffer)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);error?reject(error):resolve(value!);};
  const cancel=()=>{finish(aborted());if(reader?.readyState===1)reader.abort();};
  const timer=setTimeout(()=>{finish(Error('خواندن فایل طول کشید؛ دوباره از گالری انتخابش کن.'));if(reader?.readyState===1)reader.abort();},timeout);
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return;}
  if(typeof FileReader==='undefined'){blob.arrayBuffer().then(value=>finish(null,value),finish);return;}
  reader=new FileReader();reader.onload=()=>finish(null,reader!.result as ArrayBuffer);reader.onerror=()=>finish(reader!.error||Error('دسترسی به فایل قطع شده؛ دوباره انتخابش کن.'));reader.onabort=()=>finish(aborted());try{reader.readAsArrayBuffer(blob);}catch(error){finish(error);}
});}
export async function fingerprint(file:File,signal:AbortSignal){const n=file.size,s=1048576,date=Math.max(0,file.lastModified||0);let a=0xdeadbeef^n,b=0x41c6ce57^date;const pieces=n<=3*s?[file]:[file.slice(0,s),file.slice(Math.floor(n/2),Math.floor(n/2)+s),file.slice(n-s)];for(const part of pieces){const bytes=new Uint8Array(await readBlob(part,signal));for(const byte of bytes){a=Math.imul(a^byte,2654435761);b=Math.imul(b^byte,1597334677);}}a=Math.imul(a^(a>>>16),2246822507)^Math.imul(b^(b>>>13),3266489909);b=Math.imul(b^(b>>>16),2246822507)^Math.imul(a^(a>>>13),3266489909);return [a>>>0,b>>>0,n,date].map(v=>v.toString(36)).join('');}
interface Upload {id:string;received:number;size:number;done:boolean}
function chunk(id:string,offset:number,blob:Blob,signal:AbortSignal,progress:(n:number)=>void):Promise<Upload>{return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();let timer:ReturnType<typeof setTimeout>,settled=false;
  const finish=(error:unknown,data?:Upload)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);error?reject(error):resolve(data!);};
  const cancel=()=>{finish(aborted());xhr.abort();};
  const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>{finish(Object.assign(Error('آپلود متوقف شد.'),{retry:true}));xhr.abort();},25000);};
  xhr.open('PUT',rel(`/api/uploads/${id}`));xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('X-Creator-Token',getToken());xhr.setRequestHeader('Upload-Offset',String(offset));
  xhr.upload.onprogress=event=>{arm();progress(event.loaded);};xhr.onerror=()=>finish(Object.assign(Error('اتصال قطع شد.'),{retry:true}));xhr.onabort=()=>finish(aborted());
  xhr.onload=()=>{let data:any;try{data=JSON.parse(xhr.responseText);}catch{finish(Object.assign(Error('پاسخ آپلود دریافت نشد.'),{retry:xhr.status>=500}));return;}if(xhr.status<300||xhr.status===409)finish(null,data);else finish(Object.assign(Error(data.error||'آپلود انجام نشد.'),{retry:xhr.status>=500}));};
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return;}arm();try{xhr.send(blob);}catch(error){finish(error);}
});}
const wait=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(aborted());};const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
export async function upload(file:File,signal:AbortSignal,progress:(n:number,phase:SendProgress['phase'])=>void){
  progress(0,'reading');const key=await fingerprint(file,signal);let u=await api<Upload>('/api/uploads',{method:'POST',body:{key,size:file.size},signal});progress(u.received,'uploading');
  let failures=0;
  while(!u.done){if(signal.aborted)throw aborted();const offset=u.received;try{u=await chunk(u.id,offset,file.slice(offset,Math.min(file.size,offset+CHUNK)),signal,n=>progress(offset+n,'uploading'));if(u.received>offset)failures=0;progress(u.received,'uploading');}catch(error:any){if(signal.aborted||error?.name==='AbortError')throw aborted();if(!error.retry)throw error;if(++failures>20)throw Error('آپلود قطع شد؛ دوباره بزن تا ادامه پیدا کنه.');progress(u.received,'retrying');await wait(Math.min(failures*1200,8000),signal);u=await api<Upload>(`/api/uploads/${u.id}`,{signal});}}
  return u.id;
}
