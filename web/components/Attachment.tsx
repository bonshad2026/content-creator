import {compressionStore,useCompression} from '../compression';
import {Trash2,Minimize2,Undo2,LoaderCircle} from 'lucide-react';
import {MediaPlayer} from './MediaPlayer';
import {useObjectURL} from '../hooks';
import {draftStore} from '../draft';
import {size} from '../api';
import type {LocalMedia} from '../types';
export function Attachment({item,disabled,onError}:{item:LocalMedia;disabled:boolean;onError:(s:string)=>void}){
  const url=useObjectURL(item.file),task=useCompression()[item.id],progress=task&&(task.status==='running'||task.status==='queued')?task.progress:null;
  const compress=()=>void compressionStore.start(item);
  return <article className="pending-card" data-testid="pending-file"><button className="remove-file" aria-label={`حذف ${item.file.name}`} disabled={disabled||progress!==null} onClick={()=>draftStore.remove(item.id)}><Trash2 size={15}/></button>{url&&<MediaPlayer src={url} kind={item.type} peaks={item.peaks} duration={item.duration}/>}<div className="pending-meta"><span title={item.file.name}>{item.recovered?'ضبط بازیابی‌شده':item.file.name}</span><b>{size(item.file.size)}</b></div>{progress!==null?<div className="compression-progress"><span><LoaderCircle size={13} className="spin"/> آماده‌سازی {Math.round(progress*100)}٪</span><button onClick={()=>compressionStore.cancel(item.id)}>لغو</button></div>:item.originalFile?<button className="file-action" disabled={disabled} onClick={()=>draftStore.patchMedia(item.id,{file:item.originalFile!,originalFile:null})}><Undo2 size={13}/>اصل فایل ({size(item.originalFile.size)})</button>:item.type==='video'&&window.MediaPrep?.available()?<button className="file-action" disabled={disabled} onClick={compress}><Minimize2 size={13}/>کاهش حجم · اختیاری</button>:null}{task?.notice&&<small className="compression-notice" role="status">{task.notice}</small>}</article>;
}
