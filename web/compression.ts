import {useSyncExternalStore} from 'react';
import {draftStore,type DraftStore} from './draft';
import {message} from './api';
import type {LocalMedia} from './types';
declare global {interface Window {MediaPrep?:{available:()=>boolean;compress:(file:File,options:{signal:AbortSignal;onProgress:(p:number)=>void})=>Promise<{file:File;original:boolean;reason?:string}>}}}
export interface CompressionTask {id:string;editId:string;progress:number;status:'queued'|'running'|'done'|'failed';notice?:string}
export class CompressionStore {
  private value:Record<string,CompressionTask>={};private listeners=new Set<()=>void>();private controllers=new Map<string,AbortController>();
  constructor(private drafts:DraftStore,private compressor=()=>window.MediaPrep){drafts.subscribe(()=>{const d=drafts.getSnapshot();for(const [id,ctl]of this.controllers){const task=this.value[id];if(task&&(d.editId!==task.editId||!d.pending.some(p=>p.id===id)))ctl.abort();}});}
  private tail=Promise.resolve();private queued=new Set<string>();
  enqueue(item:LocalMedia){if(this.queued.has(item.id)||this.controllers.has(item.id))return;this.queued.add(item.id);this.update({id:item.id,editId:this.drafts.getSnapshot().editId,progress:0,status:'queued'});this.tail=this.tail.catch(()=>{}).then(async()=>{if(!this.queued.delete(item.id))return;await this.start(item);});}
  getSnapshot=()=>this.value;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};
  private update(task:CompressionTask){this.value={...this.value,[task.id]:task};this.listeners.forEach(fn=>fn());}
  cancel=(id:string)=>{if(this.queued.delete(id)&&this.value[id])this.update({...this.value[id],status:'failed',notice:'فشرده‌سازی لغو شد.'});this.controllers.get(id)?.abort();};
  async start(item:LocalMedia){
    if(this.controllers.has(item.id))return;
    const d=this.drafts.getSnapshot(),editId=d.editId,source=item.file;
    if(!d.pending.some(p=>p.id===item.id&&p.file===source))return;
    const task:CompressionTask={id:item.id,editId,progress:0,status:'running'};
    if(this.controllers.size){this.update({...task,status:'failed',notice:'اول فشرده‌سازی فایل قبلی رو تمام یا لغو کن.'});return;}
    const ctl=new AbortController();this.controllers.set(item.id,ctl);this.update(task);
    const stillOwned=()=>this.drafts.getSnapshot().editId===editId&&this.drafts.getSnapshot().pending.some(p=>p.id===item.id&&p.file===source);
    try{const prep=this.compressor();if(!prep?.available())throw Error('این مرورگر فشرده‌سازی رو پشتیبانی نمی‌کنه.');
      const result=await prep.compress(source,{signal:ctl.signal,onProgress:p=>{if(!ctl.signal.aborted)this.update({...task,progress:p});}});
      if(ctl.signal.aborted||!stillOwned())return;
      if(!result.original)this.drafts.patchMedia(item.id,{file:result.file,originalFile:source});
      this.update({...task,progress:1,status:'done',notice:result.original?(result.reason||'حجم فایل مناسبه.'):undefined});
    }catch(e){if(stillOwned())this.update({...task,status:'failed',notice:ctl.signal.aborted?'فشرده‌سازی لغو شد؛ اصل فایل محفوظ است.':message(e)});}
    finally{this.controllers.delete(item.id);if(this.value[item.id]?.status==='running')this.update({...task,status:'failed',notice:'فشرده‌سازی لغو شد؛ اصل فایل محفوظ است.'});}
  }
}
export const compressionStore=new CompressionStore(draftStore);
export const useCompression=()=>useSyncExternalStore(compressionStore.subscribe,compressionStore.getSnapshot);
