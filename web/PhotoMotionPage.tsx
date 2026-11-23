import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ImagePlus,Clapperboard,LoaderCircle,Trash2,X,Send} from 'lucide-react';
import {api,fa,message,rel,uid} from './api';
import {upload} from './upload';
import {photoDraft} from './photo-draft';
import {Modal} from './components/Modal';
import {MediaPlayer} from './components/MediaPlayer';
import {ProcessingStatus} from './components/ProcessingStatus';
import type {Edit} from './types';
interface PhotoEdit extends Omit<Edit,'assets'>{assets:{id:string;name:string;type:'image'}[];canApprove?:boolean;preview?:{id:string;status:string;video:string|null;question:string|null;error:string|null}|null}
export function PhotoMotionPage({id,owner,onChanged,navigate}:{id:string;owner:string;onChanged:()=>void;navigate:(hash:string)=>void}){
  const [edit,setEdit]=useState<PhotoEdit|null>(null),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[percent,setPercent]=useState(0),[confirm,setConfirm]=useState(false),[loaded,setLoaded]=useState(false);
  const input=useRef<HTMLInputElement>(null),key=`${owner}:${id}`,ctl=useRef<AbortController|null>(null);
  const requestRef=useRef<{id:string;text:string}|null>(null);
  const [text,setText]=useState(()=>{try{return localStorage.getItem(key+':brief')||'';}catch{return '';}});
  useEffect(()=>{try{localStorage.setItem(key+':brief',text);}catch{}},[key,text]);
  useEffect(()=>{let live=true;void photoDraft.load(key).then(f=>{if(live){setFile(f||null);setLoaded(true);}}).catch(()=>{if(live){setLoaded(true);setError('ذخیرهٔ عکس روی گوشی در دسترس نیست.');}});return()=>{live=false;};},[key]);
  useEffect(()=>{if(!file){setPreview('');return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
  useEffect(()=>{const c=new AbortController();let timer:ReturnType<typeof setTimeout>;const load=async()=>{try{const e=await api<PhotoEdit>(`/api/edits/${id}`,{signal:c.signal});if(c.signal.aborted)return;setEdit(e);if(['analyzing','rendering'].includes(e.status))timer=setTimeout(load,1200);}catch(e){if(!c.signal.aborted)setError(message(e));}};void load();return()=>{c.abort();clearTimeout(timer);};},[id,edit?.status==='analyzing'||edit?.status==='rendering']);
  async function choose(next:File|undefined){if(!next)return;setError('');if(next.size>25*1024*1024){setError('حداکثر حجم عکس ۲۵ مگابایت است.');return;}if(!/\.(jpe?g|png|webp)$/i.test(next.name)&&!['image/jpeg','image/png','image/webp'].includes(next.type)){setError('عکس JPG، PNG یا WebP انتخاب کن.');return;}setFile(next);try{await photoDraft.save(key,next);}catch{setError('ذخیره روی گوشی انجام نشد؛ عکس را قبل از خروج بفرست.');}}
  async function send(){if(!file||busy)return;setBusy(true);setError('');setPercent(0);const current=file,c=new AbortController();ctl.current=c;
    try{const uploadId=await upload(current,c.signal,n=>setPercent(Math.round(n/current.size*100)));const next=await api<PhotoEdit>(`/api/edits/${id}/photo`,{method:'POST',body:{upload:uploadId,name:current.name},signal:c.signal,timeout:120000});setEdit(next);setFile(null);await photoDraft.clear(key);onChanged();}
    catch(e){if(!c.signal.aborted)setError(message(e));}finally{setBusy(false);ctl.current=null;}}
  async function build(){if(!edit?.build?.canBuild||busy)return;setBusy(true);setError('');try{let attempt=requestRef.current;try{attempt=JSON.parse(localStorage.getItem(key+':request')||'null');}catch{}if(!attempt||attempt.text!==text){attempt={id:uid(),text};requestRef.current=attempt;try{localStorage.setItem(key+':request',JSON.stringify(attempt));}catch{}}const next=await api<PhotoEdit>(`/api/edits/${id}/render`,{method:'POST',body:{text,requestId:attempt.id}});setEdit(next);setText('');requestRef.current=null;try{localStorage.removeItem(key+':request');}catch{}onChanged();}catch(e){setError(message(e));}finally{setBusy(false);}}
  async function approve(){if(!edit?.canApprove||busy)return;setBusy(true);try{const next=await api<PhotoEdit>(`/api/edits/${id}/approve`,{method:'POST'});setEdit(next);onChanged();if(next.jobId)navigate(`#/job/${next.jobId}`);}catch(e){setError(message(e));}finally{setBusy(false);}}
  if(!edit)return <div className="page-loading">{error?<p role="alert">{error}</p>:<LoaderCircle className="spin"/>}</div>;
  const closed=!!edit.jobId||!!edit.archived,processing=['analyzing','rendering'].includes(edit.status);
  return <section className="chat-page photo-motion-page" aria-label="موشن تک‌عکس"><header className="chat-header"><button className="icon-button" aria-label="برگشت به خانه" onClick={()=>navigate('#/home')}><ArrowRight/></button><div className="chat-avatar"><ImagePlus size={21}/></div><div className="chat-title"><h1>موشن تک‌عکس</h1><span>آزمایشی · ۶ ثانیه</span></div>{edit.jobId?<button className="button chat-build" onClick={()=>navigate(`#/job/${edit.jobId}`)}>خروجی</button>:<><button className="button chat-build" disabled={busy||!!file||!!text.trim()||edit.archived||(!edit.canApprove&&!edit.build?.canBuild)} onClick={()=>void (edit.canApprove?approve():build())}><Clapperboard size={16}/>{edit.canApprove?'تأیید خروجی':'ساخت موشن'}</button><button className="icon-button" aria-label="لغو ادیت" disabled={busy||processing||edit.archived} onClick={()=>setConfirm(true)}><Trash2 size={18}/></button></>}</header>
    <div className="chat-scroll photo-thread">
      {!edit.messages.length&&<article className="message-bubble incoming"><p>یک عکس محصول بفرست.</p></article>}
      {edit.messages.map((m,i)=>(m.text||m.assetIds?.includes(edit.assets[0]?.id))&&<article key={i} className={`message-bubble ${m.role==='user'?'outgoing':'incoming'}`}>{m.assetIds?.includes(edit.assets[0]?.id)&&<img className="photo-bubble" src={rel(`/api/edits/${id}/photo?asset=${edit.assets[0].id}`)} alt="عکس ارسالی محصول"/>}{m.text&&<p>{m.text}</p>}</article>)}
      {edit.assets.length>0&&!edit.messages.some(m=>m.assetIds?.includes(edit.assets[0].id))&&<article className="message-bubble outgoing"><img className="photo-bubble" src={rel(`/api/edits/${id}/photo?asset=${edit.assets[0].id}`)} alt="عکس ارسالی محصول"/></article>}
      {edit.preview?.video&&<article className="message-bubble incoming photo-video"><MediaPlayer src={rel(edit.preview.video)} kind="video"/><p>چه تغییری می‌خواهی؟</p></article>}
      {edit.preview?.question&&<article className="message-bubble incoming"><p>{edit.preview.question}</p></article>}
      {file&&!closed&&<article className="message-bubble outgoing"><img className="photo-bubble" src={preview||undefined} alt="پیش‌نمایش عکس انتخابی"/>{busy?<div className="photo-upload-status" role="status"><LoaderCircle className="spin" size={14}/>{percent<100?`ارسال ${fa(percent)}٪`:'در حال آماده‌سازی عکس'}</div>:<button className="text-button" onClick={async()=>{setFile(null);await photoDraft.clear(key);}}>حذف عکس</button>}</article>}
      {processing&&!busy&&<ProcessingStatus render progress={edit.progress}/>}
      {edit.preview?.status==='error'&&!closed&&<button className="button ghost" disabled={busy} onClick={async()=>{setBusy(true);try{await api(`/api/jobs/${edit.preview!.id}/retry`,{method:'POST'});setEdit({...edit,status:'rendering'});}catch(e){setError(message(e));}finally{setBusy(false);}}}>تلاش دوباره</button>}
    </div>
    {!closed&&<footer className="composer photo-composer">{(error||edit.error)&&<p className="composer-error" role="alert">{error||edit.error}</p>}
      {edit.assets.length>0&&!file&&<form className="photo-direction" onSubmit={e=>{e.preventDefault();void build();}}>
        <input aria-label="نظر دربارهٔ موشن" placeholder={edit.preview?.question?'پاسخت را بنویس':'چه تغییری می‌خواهی؟'} value={text} maxLength={1000} disabled={busy||processing} onChange={e=>setText(e.target.value)}/>
        <button className="button" disabled={busy||!edit.build?.canBuild||!text.trim()}>ارسال نظر</button>
        {!edit.preview&&<small>ساخت با هوش مصنوعی اعتبار مصرف می‌کند.</small>}
      </form>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e=>{void choose(e.target.files?.[0]);e.target.value='';}}/>
      <button className="button ghost" disabled={busy||!loaded||processing} onClick={()=>input.current?.click()}><ImagePlus size={19}/>{file||edit.assets.length?'انتخاب عکس دیگر':'انتخاب عکس'}</button>
      {file&&<button className="button" disabled={busy} onClick={()=>void send()}><Send size={17}/>ارسال عکس</button>}{busy&&ctl.current&&<button className="icon-button" aria-label="توقف ارسال" onClick={()=>ctl.current?.abort()}><X/></button>}
    </footer>}
    {confirm&&<Modal title="لغو ادیت؟" onClose={()=>setConfirm(false)} busy={busy}><p>این پیش‌نویس حذف می‌شود.</p><div className="photo-actions"><button className="button ghost" onClick={()=>setConfirm(false)}>ادامهٔ ادیت</button><button className="button" disabled={busy} onClick={async()=>{setBusy(true);try{await api(`/api/edits/${id}/discard`,{method:'POST',body:{confirm:true}});await photoDraft.clear(key);onChanged();navigate('#/home');}catch(e){setConfirm(false);setError(message(e));}finally{setBusy(false);}}}>لغو ادیت</button></div></Modal>}
  </section>;
}
