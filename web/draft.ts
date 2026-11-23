import type {Draft,LocalMedia} from './types';
import {message} from './api';
export interface DraftRepository {load(owner:string,id:string):Promise<any>;meta(owner:string,data:any):Promise<void>;file(owner:string,item:LocalMedia):Promise<void>;drop(owner:string,id:string):Promise<void>;clear(owner:string):Promise<void>}
let dbPromise:Promise<IDBDatabase>|undefined;
function db(){return dbPromise??=new Promise((resolve,reject)=>{const r=indexedDB.open('creator-chat-draft:'+location.pathname.replace(/[^/]*$/,''),1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('meta'))r.result.createObjectStore('meta');if(!r.result.objectStoreNames.contains('files'))r.result.createObjectStore('files');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('ذخیرهٔ محلی در تب دیگری قفل شده.'));});}
async function tx(store:string,mode:IDBTransactionMode,fn:(s:IDBObjectStore)=>IDBRequest){const database=await db();return new Promise<any>((resolve,reject)=>{const t=database.transaction(store,mode),r=fn(t.objectStore(store));const timer=setTimeout(()=>{try{t.abort();}catch{}reject(Error('ذخیره روی گوشی طول کشید؛ فایل رو قبل از خروج ارسال کن.'));},20000);t.oncomplete=()=>{clearTimeout(timer);resolve(r.result);};t.onabort=t.onerror=()=>{clearTimeout(timer);reject(t.error||Error('فضای کافی برای ذخیرهٔ پیش‌نویس نیست.'));};});}
const key=(owner:string,id:string)=>`${owner}:${id}`;
export const repository:DraftRepository={
  async load(owner,id){const meta=await tx('meta','readonly',s=>s.get(owner));if(!meta||meta.editId!==id)return null;const pending:LocalMedia[]=[];let missing=false;for(const item of meta.pending||[]){const original=await tx('files','readonly',s=>s.get(key(owner,item.id)));if(!original){missing=true;continue;}const prepared=item.prepared?await tx('files','readonly',s=>s.get(key(owner,item.id)+':prepared')):null;pending.push({...item,file:prepared||original,originalFile:prepared?original:null,saved:true});}return {...meta,pending,missing};},
  async meta(owner,data){await tx('meta','readwrite',s=>s.put({...data,updatedAt:Date.now()},owner));},
  async file(owner,item){await tx('files','readwrite',s=>s.put(item.originalFile||item.file,key(owner,item.id)));if(item.originalFile)await tx('files','readwrite',s=>s.put(item.file,key(owner,item.id)+':prepared'));},
  async drop(owner,id){await tx('files','readwrite',s=>s.delete(key(owner,id)));await tx('files','readwrite',s=>s.delete(key(owner,id)+':prepared'));},
  async clear(owner){const m=await tx('meta','readonly',s=>s.get(owner));for(const p of m?.pending||[])await this.drop(owner,p.id);await tx('meta','readwrite',s=>s.delete(owner));},
};
export class DraftStore {
  private value:Draft={editId:'',text:'',part:'',pending:[],transcriptEdits:{},saveState:'saved',loaded:false};
  private listeners=new Set<()=>void>();private generation=0;private writing=Promise.resolve();private owner='';private saves=0;
  constructor(private repo:DraftRepository=repository){}
  getSnapshot=()=>this.value;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};
  private update(patch:Partial<Draft>){this.value={...this.value,...patch};this.listeners.forEach(fn=>fn());}
  private metadata(){return {...this.value,pending:this.value.pending.map(p=>({id:p.id,type:p.type,name:p.file.name,prepared:!!p.originalFile,peaks:p.peaks,duration:p.duration,recovered:p.recovered})),loaded:undefined,saveState:undefined,error:undefined};}
  private save(operation?:()=>Promise<void>){const version=this.generation,owner=this.owner;const meta=this.metadata();this.saves++;this.update({saveState:'saving'});
    this.writing=this.writing.catch(()=>{}).then(async()=>{if(version!==this.generation)return;await operation?.();await this.repo.meta(owner,meta);}).then(()=>{if(version===this.generation){this.saves--;this.update({saveState:this.saves?'saving':'saved'});}}).catch(error=>{if(version===this.generation){this.saves=Math.max(0,this.saves-1);this.update({saveState:'error',error:'ذخیره روی گوشی انجام نشد؛ فایل رو قبل از خروج ارسال کن. '+message(error)});}});return this.writing;}
  async activate(owner:string,id:string){if(this.owner===owner&&this.value.editId===id&&this.value.loaded)return;await this.writing;const version=++this.generation;this.owner=owner;this.saves=0;this.update({editId:id,text:'',part:'',pending:[],transcriptEdits:{},loaded:false,error:undefined,saveState:'saved',sendAttempt:undefined});try{const d=await this.repo.load(owner,id);if(version!==this.generation)return;this.update({...(d?{text:d.text||'',part:d.part||'',pending:d.pending||[],transcriptEdits:d.transcriptEdits||{},sendAttempt:d.sendAttempt}:{}),loaded:true,error:d?.missing?'بعضی فایل‌ها از حافظهٔ گوشی پاک شده‌اند؛ دوباره انتخابشون کن.':undefined});}catch{if(version===this.generation)this.update({loaded:true,saveState:'error',error:'ذخیرهٔ محلی این مرورگر در دسترس نیست؛ قبل از خروج فایل‌ها رو ارسال کن.'});}}
  text(text:string){this.update({text});void this.save();}
  part(part:string){this.update({part});void this.save();}
  transcript(id:string,text:string){this.update({transcriptEdits:{...this.value.transcriptEdits,[id]:text}});void this.save();}
  clearTranscript(){this.update({transcriptEdits:{}});void this.save();}
  add(item:LocalMedia){this.update({pending:[...this.value.pending.filter(p=>p.id!==item.id),item]});void this.save(()=>this.repo.file(this.owner,item));}
  patchMedia(id:string,patch:Partial<LocalMedia>){const previous=this.value.pending.find(p=>p.id===id);if(!previous)return;const item={...previous,...patch};this.update({pending:this.value.pending.map(p=>p.id===id?item:p)});void this.save(()=>this.repo.file(this.owner,item));}
  remove(id:string){this.update({pending:this.value.pending.filter(p=>p.id!==id)});void this.save(()=>this.repo.drop(this.owner,id));}
  attempt(attempt:Draft['sendAttempt']){this.update({sendAttempt:attempt});void this.save();}
  acknowledge(ids:string[],text:string){this.update({pending:this.value.pending.filter(p=>!ids.includes(p.id)),text:this.value.text===text?'':this.value.text,sendAttempt:undefined});void this.save(async()=>{for(const id of ids)await this.repo.drop(this.owner,id);});}
  async discard(){await this.writing;this.generation++;await this.repo.clear(this.owner);this.update({editId:'',text:'',part:'',pending:[],transcriptEdits:{},loaded:false,saveState:'saved',error:undefined,sendAttempt:undefined});}
  flush=()=>this.writing;
}
export const draftStore=new DraftStore();
