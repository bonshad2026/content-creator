import {useState} from 'react';
import {LoaderCircle,RefreshCw} from 'lucide-react';
import {api,message} from '../api';
import type {Edit} from '../types';
import {Modal} from './Modal';

export function ReviseButton({editId,jobId,onReady}:{editId:string;jobId:string;onReady:(edit:Edit)=>void}){
  const [open,setOpen]=useState(false),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <><button className="button ghost" onClick={()=>{setError('');setOpen(true);}}><RefreshCw size={16}/>اصلاح این نسخه</button>{open&&<Modal title="چی رو اصلاح کنیم؟" busy={busy} onClose={()=>setOpen(false)}><form className="stack" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const next=await api<Edit>(`/api/edits/${editId}/revise`,{method:'POST',body:{jobId,text}});setOpen(false);onReady(next);}catch(e){setError(message(e));}finally{setBusy(false);}}}><p className="dialog-description">زمان و مشکل رو بگو؛ مثلاً «نمای محصول دوم اشتباهه، از نمای دیگرش استفاده کن». اصلاح در محدودهٔ همین قالب انجام می‌شه؛ فایل مکمل رو هم می‌تونی در چت بفرستی.</p><textarea aria-label="درخواست اصلاح" rows={4} maxLength={1000} required value={text} onChange={e=>setText(e.target.value)} placeholder="کجای ویدیو و چه تغییری؟"/><small>نسخهٔ قبلی می‌مونه. بررسی با ارسال این درخواست شروع می‌شه؛ ساخت خروجی جدید از سهمیهٔ ریلز استفاده می‌کنه. فایل خام باید هنوز موجود باشه (معمولاً ۷ روز).</small>{error&&<div role="alert"><p className="error-text">{error}</p><a className="text-button" href="#/home" onClick={()=>setOpen(false)}>رفتن به پیش‌نویس فعلی</a></div>}<div className="dialog-actions"><button className="button ghost" type="button" disabled={busy} onClick={()=>setOpen(false)}>انصراف</button><button className="button" disabled={busy||!text.trim()}>{busy?<LoaderCircle size={16} className="spin"/>:<RefreshCw size={16}/>}ادامه در چت</button></div></form></Modal>}</>;
}
