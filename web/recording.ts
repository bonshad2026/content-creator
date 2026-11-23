import {useCallback,useEffect,useRef,useState} from 'react';
import {draftStore} from './draft';
import {message,uid} from './api';
import type {MediaKind} from './types';
export async function audioPeaks(file:File):Promise<{peaks:number[];duration:number}|null>{if(file.size>16*1048576)return null;const Audio=window.AudioContext||(window as any).webkitAudioContext;if(!Audio)return null;const context=new Audio();try{const buffer=await context.decodeAudioData(await file.arrayBuffer()),data=buffer.getChannelData(0),out:number[]=[];for(let i=0;i<44;i++){let peak=0;for(let j=Math.floor(i*data.length/44);j<Math.floor((i+1)*data.length/44);j+=8)peak=Math.max(peak,Math.abs(data[j]));out.push(peak);}const max=Math.max(.01,...out);return{peaks:out.map(n=>n/max),duration:buffer.duration};}catch{return null;}finally{await context.close().catch(()=>{});}}
export function useRecorder(){
  const [state,setState]=useState<{phase:'idle'|'acquiring'|'recording';kind:MediaKind;stream?:MediaStream;error?:string}>({phase:'idle',kind:'audio'});
  const recording=useRef<{recorder:MediaRecorder;stream:MediaStream;chunks:Blob[];id:string;kind:MediaKind;editId:string;start:number;discard:boolean;lastSave:number;timer:ReturnType<typeof setTimeout>}|null>(null),alive=useRef(true),request=useRef(0);
  const stop=useCallback((discard=false)=>{const current=recording.current;if(!current){request.current++;if(alive.current)setState(s=>({...s,phase:'idle',stream:undefined}));return;}current.discard=discard;if(current.recorder.state!=='inactive')current.recorder.stop();current.stream.getTracks().forEach(t=>t.stop());clearTimeout(current.timer);},[]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++;stop(false);};},[stop]);
  const capture=(kind:MediaKind,stream:MediaStream)=>{
    if(recording.current)return;
    try{
      const types=['audio/webm;codecs=opus','audio/mp4'];const mimeType=types.find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=new MediaRecorder(stream,{...(mimeType?{mimeType}:{}),audioBitsPerSecond:128000});
      const current={recorder,stream,chunks:[] as Blob[],id:uid(),kind,editId:draftStore.getSnapshot().editId,start:Date.now(),discard:false,lastSave:0,timer:setTimeout(()=>stop(false),180000)};recording.current=current;
      const snapshot=(recovered:boolean)=>{if(current.discard||!current.chunks.length||draftStore.getSnapshot().editId!==current.editId)return;const type=recorder.mimeType||current.chunks[0].type,ext=type.includes('mp4')?'mp4':'webm';const file=new File(current.chunks,`ضبط-${new Date(current.start).toISOString().slice(11,19).replace(/:/g,'-')}.${ext}`,{type,lastModified:current.start});draftStore.add({id:current.id,type:kind,file,duration:(Date.now()-current.start)/1000,recovered});return file;};
      recorder.ondataavailable=event=>{if(!event.data.size)return;current.chunks.push(event.data);if(Date.now()-current.lastSave>4000){current.lastSave=Date.now();snapshot(true);}};
      recorder.onstop=()=>{const file=snapshot(false);if(current.discard)draftStore.remove(current.id);clearTimeout(current.timer);stream.getTracks().forEach(t=>t.stop());recording.current=null;if(alive.current)setState({phase:'idle',kind});if(file&&kind==='audio')void audioPeaks(file).then(result=>{if(result&&draftStore.getSnapshot().editId===current.editId)draftStore.patchMedia(current.id,result);});};
      recorder.onerror=()=>{current.discard=true;stop(true);if(alive.current)setState({phase:'idle',kind,error:'ضبط متوقف شد؛ دوباره امتحان کن.'});};recorder.start(1000);setState({phase:'recording',kind,stream});
    }catch(error){if(recording.current){clearTimeout(recording.current.timer);recording.current=null;}stream.getTracks().forEach(t=>t.stop());if(alive.current)setState({phase:'idle',kind,error:message(error)});}
  };
  const start=async(kind:'audio')=>{
    if(state.phase!=='idle')return;
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){setState({phase:'idle',kind,error:'ضبط صدا به HTTPS و مرورگر سازگار نیاز داره.'});return;}
    const serial=++request.current;setState({phase:'acquiring',kind});
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:false,autoGainControl:true},video:false});
      if(!alive.current||serial!==request.current){stream.getTracks().forEach(t=>t.stop());return;}
      capture(kind,stream);
    }catch(error){if(alive.current&&serial===request.current)setState({phase:'idle',kind,error:(error as Error).name==='NotAllowedError'?'اجازهٔ میکروفن داده نشد؛ از تنظیمات مرورگر فعالش کن.':message(error)});}
  };
  return {...state,start,stop,recordingId:recording.current?.id};
}
