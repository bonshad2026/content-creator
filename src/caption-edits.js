// Captions are an editable presentation layer, separate from recorded speech and ASR evidence.
const canonical=value=>String(value).normalize('NFKC').replace(/[يك]/g,c=>c==='ي'?'ی':'ک').replace(/[\p{P}\p{Z}\s\u200c\u200d]/gu,'');
export const captionText=(analysis,segment)=>analysis?.captionEdits?.find(edit=>edit.id===segment.id)?.text??segment.text;
export function captionPresentation(analysis,segment) {
  const text=captionText(analysis,segment),source=segment.words||[];
  if(text===segment.text)return {text,words:source};
  const tokens=text.trim().split(/\s+/);
  const aligned=tokens.length===source.length&&source.length&&segment.timingStatus!=='uncertain'&&canonical(source.map(w=>w.text).join(' '))===canonical(segment.text)&&source.every((w,i)=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start&&w.end-w.start<2.5&&w.start>=segment.start-.1&&w.end<=segment.end+.1&&(!i||w.start>=source[i-1].end-.04));
  // A different word count cannot inherit unrelated old word timings. Use honest phrase timing.
  return {text,words:aligned?source.map((w,i)=>({...w,text:tokens[i]})):[]};
}
export function assertCaptionEdits(edits,assets) {
  const ids=new Set(assets.flatMap(a=>(a.segments||[]).map(s=>s.id))),seen=new Set();
  for(const edit of edits||[]) {
    if(!ids.has(edit.id)||seen.has(edit.id)||typeof edit.text!=='string'||!edit.text.trim()||edit.text.length>600)throw Object.assign(Error('اصلاح زیرنویس معتبر نیست.'),{code:'INVALID_CAPTION_EDIT',status:400});
    seen.add(edit.id);
  }
}
