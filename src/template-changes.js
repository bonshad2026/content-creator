// The template adapter owns paths and values; the generic executor owns transactions.
import {analysisSchema,validateEvidence} from './templates.js';
import {normalizeAdjustments} from './adjustments.js';
import {productPictureRanges} from './template-picture.js';
import {assertCaptionEdits,captionText} from './caption-edits.js';
import {executeChanges} from './edit-changes.js';

export function selectionState(value,assets=[]) {
  const state=analysisSchema.parse(value||{opening:[],closing:[],products:[],uncertain:false});
  delete state.dialogue;delete state.adjustmentWarnings;
  state.products=state.products.map((p,i)=>({...p,id:p.id||`product-${i}`}));
  state.adjustments=normalizeAdjustments(state.adjustments,assets).value;
  return state;
}
export function executeCaptionChanges(previous,assets,edits) {
  assertCaptionEdits(edits,assets);
  const before=selectionState(previous,assets),segments=new Map(assets.flatMap(a=>(a.segments||[]).map(s=>[s.id,s])));
  const changed=edits.filter(c=>captionText(before,segments.get(c.id))!==c.text);
  const proposal={...before,captionEdits:[...before.captionEdits.filter(c=>!changed.some(n=>n.id===c.id)),...changed]};
  const operations=changed.map(c=>({type:'update',target:`captions/${c.id}`,assetIds:[]}));
  return executeChanges({before,proposal,operations,adapter:templateChangeAdapter(assets,proposal)});
}
export function templateChangeAdapter(assets,rawProposal) {
  const segments=new Map(assets.flatMap(a=>(a.segments||[]).map(s=>[s.id,a]))),frames=new Map(assets.flatMap(a=>(a.frames||[]).map(f=>[f.id,a])));
  const validRefs=(refs,kind)=>Array.isArray(refs)&&refs.every(id=>kind==='visuals'?frames.has(id):segments.has(id)&&(kind!=='presenter'||segments.get(id).type==='video'));
  const strictPart=(raw,normalized,kind)=>validRefs(raw,kind)&&JSON.stringify([...new Set(raw)])===JSON.stringify(normalized);
  return (current,proposal,op)=>{
    const next=structuredClone(current),parts=op.target.split('/'),remove=op.type==='remove';
    const assignRefs=(before,after)=>op.type==='append'?[...new Set([...before,...after])]:after;
    if(parts[0]==='captions'&&parts.length===2) {
      const id=parts[1],edit=proposal.captionEdits.find(c=>c.id===id);
      if(!segments.has(id)||!['update','remove'].includes(op.type)||!remove&&!edit)return {problem:'invalid-caption-edit'};
      if(!remove){try{assertCaptionEdits([edit],assets);}catch{return {problem:'invalid-caption-edit'};}}
      next.captionEdits=next.captionEdits.filter(c=>c.id!==id);
      if(!remove)next.captionEdits.push(structuredClone(edit));
    } else if(parts.length===1&&['opening','closing'].includes(parts[0])) {
      const key=parts[0];
      if(!remove&&!strictPart(rawProposal[key],proposal[key],'presenter'))return {problem:'invalid-evidence'};
      next[key]=remove?[]:assignRefs(next[key],proposal[key]);
    } else if(op.target==='products') {
      if(!remove&&rawProposal.products.some(p=>!validRefs(p.speech,'speech')||!validRefs(p.visuals,'visuals')))return {problem:'invalid-evidence'};
      if(remove)next.products=[];
      else if(op.type==='append') {
        const existing=new Set(next.products.map(p=>p.id)),added=proposal.products.filter(p=>!existing.has(p.id));
        next.products.push(...structuredClone(added));
      } else next.products=structuredClone(proposal.products);
    } else if(op.target==='sequence/products') {
      if(op.type!=='update'||proposal.products.length!==next.products.length||proposal.products.some(p=>!next.products.some(old=>old.id===p.id)))return {problem:'invalid-order'};
      next.products=proposal.products.map(p=>next.products.find(old=>old.id===p.id));
    } else if(parts[0]==='products'&&[2,3].includes(parts.length)) {
      const [,id,key]=parts,at=next.products.findIndex(p=>p.id===id),value=proposal.products.find(p=>p.id===id),raw=rawProposal.products.find((p,i)=>(p.id||`product-${i}`)===id);
      if(parts.length===2) {
        if(remove){if(at<0)return {problem:'invalid-target'};next.products.splice(at,1);}
        else {
          if(!value||!raw||!strictPart(raw.speech,value.speech,'speech')||!strictPart(raw.visuals,value.visuals,'visuals'))return {problem:'invalid-evidence'};
          if(at<0&&op.type!=='append')return {problem:'invalid-target'};
          if(at>=0&&op.type==='append')return {problem:'ambiguous-append'};
          if(at<0)next.products.push(structuredClone(value));else next.products[at]=structuredClone(value);
        }
      } else {
        if(at<0||!['speech','visuals','name'].includes(key))return {problem:'invalid-target'};
        if(key==='name') {
          if(remove||!value)return {problem:'invalid-name-change'};
          next.products[at].name=value.name;
        } else {
          if(!remove&&(!value||!raw||!strictPart(raw[key],value[key],key)))return {problem:'invalid-evidence'};
          next.products[at][key]=remove?[]:assignRefs(next.products[at][key],value[key]);
          if(key==='visuals') {
            const ranges=remove?[]:value.visualRanges;
            if(ranges?.length)next.products[at].visualRanges=op.type==='append'?[...(next.products[at].visualRanges||[]).filter(r=>!ranges.some(n=>n.frameId===r.frameId)),...structuredClone(ranges)]:structuredClone(ranges);
            else delete next.products[at].visualRanges;
          }
        }
      }
    } else if(parts[0]==='adjustments') {
      const [,key,segment]=parts;
      if(!['update','remove'].includes(op.type))return {problem:'invalid-setting-operation'};
      if(parts.length===2&&['fontSize','gainDb'].includes(key)) {
        const value=rawProposal.adjustments?.[key],limit=key==='fontSize'?[32,64]:[-12,6];
        if(!remove&&(!Number.isFinite(value)||value<limit[0]||value>limit[1]))return {ignored:key==='fontSize'?'اندازهٔ فونت خارج از محدوده‌ست؛ اعمال نشد.':'بلندی صدا خارج از محدوده‌ست؛ اعمال نشد.'};
        next.adjustments[key]=remove?(key==='fontSize'?44:0):proposal.adjustments[key];
      } else if(key==='speeds'&&parts.length===3&&segments.has(segment)) {
        const value=rawProposal.adjustments?.speeds?.[segment];
        if(!remove&&(!Number.isFinite(value)||value<.75||value>1.25))return {ignored:'سرعت خارج از محدوده اعمال نشد.'};
        next.adjustments.speeds[segment]=remove?1:value;
      } else if(key==='speeds'&&parts.length===2) {
        const input=rawProposal.adjustments?.speeds;
        if(!remove&&(!input||Object.entries(input).some(([id,v])=>!segments.has(id)||!Number.isFinite(v)||v<.75||v>1.25)))return {ignored:'سرعت خارج از محدوده اعمال نشد.'};
        next.adjustments.speeds=remove?Object.fromEntries(Object.keys(next.adjustments.speeds).map(id=>[id,1])):structuredClone(proposal.adjustments.speeds);
      } else return {problem:'invalid-target'};
    } else return {problem:'invalid-target'};
    const checked=validateEvidence(next,assets,current.adjustments);
    for(const product of checked.products)if(product.visualRanges?.length){try{productPictureRanges(product,assets);}catch(error){if(error.code==='VISUAL_RANGE')return {problem:'invalid-visual-range'};}}
    if(checked.adjustmentWarnings.length)return {ignored:checked.adjustmentWarnings.join(' ')};
    delete checked.adjustmentWarnings;delete checked.dialogue;
    return {state:checked};
  };
}
