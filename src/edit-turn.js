// One pure transition: interpretation -> scoped transaction -> validation -> committed state.
import {isDeepStrictEqual} from 'node:util';
import {validateEvidence} from './templates.js';
import {assessDialogue} from './conversation.js';
import {templateTargets} from './template-conversation.js';
import {selectionState,templateChangeAdapter} from './template-changes.js';
import {executeChanges} from './edit-changes.js';
import {productPictureRanges} from './template-picture.js';
import {captionText} from './caption-edits.js';

export function resolveEditTurn({previous,proposal,assets,turn={},previousMemory=null}) {
  const candidate=validateEvidence(proposal,assets,previous?.adjustments),before=selectionState(previous,assets),suggested=selectionState(candidate,assets);
  const warnings=candidate.adjustmentWarnings||[],decision=candidate.dialogue;
  if(!decision)return {analysis:previous||suggested,dialogue:null,execution:{mode:'demo',applied:[],ignored:[],problems:[]},warnings};
  const executing=['apply','need_input'].includes(decision.disposition);
  let execution={state:before,mode:'none',applied:[],ignored:[],problems:[],changed:false};
  if(executing&&previous===null) {
    // Initial assembly is an explicit server-owned mode; later turns never replace all state.
    const includes=(raw,valid)=>raw.every(id=>valid.includes(id));
    if(!includes(proposal.opening,suggested.opening)||!includes(proposal.closing,suggested.closing)||proposal.products.some((p,i)=>!includes(p.speech,suggested.products[i].speech)||!includes(p.visuals,suggested.products[i].visuals)))execution.problems.push({code:'invalid-evidence',target:'initial'});
    else {
      const initial={...suggested,captionEdits:[]},captionOperations=decision.operations.filter(op=>op.target.startsWith('captions/'));
      const captions=executeChanges({before:initial,proposal:suggested,operations:captionOperations,adapter:templateChangeAdapter(assets,proposal)});
      execution={...execution,mode:'initial',state:captions.state,applied:captions.problems.length?[]:decision.operations,problems:captions.problems,changed:!isDeepStrictEqual(before,captions.state)};
    }
    for(const product of suggested.products)if(product.visualRanges?.length){try{productPictureRanges(product,assets);}catch(error){if(error.code==='VISUAL_RANGE')execution.problems.push({code:'invalid-visual-range',target:product.id});}}
  } else if(executing) {
    execution={mode:'patch',...executeChanges({before,proposal:suggested,operations:decision.operations,adapter:templateChangeAdapter(assets,proposal)})};
    if(!decision.operations.length&&!isDeepStrictEqual(templateTargets(before,assets),templateTargets(suggested,assets)))execution.problems.push({code:'missing-operations',target:''});
  }
  // Only operations that actually ran may be called applied. Bounded impossible values are set aside.
  const effective=structuredClone(decision);
  if(!executing&&(candidate.captionEdits||[]).some(edit=>{
    const segment=assets.flatMap(a=>a.segments||[]).find(s=>s.id===edit.id);
    return !segment||captionText(before,segment)!==edit.text;
  }))execution.problems.push({code:'caption-change-not-executed',target:'captions'});
  if(effective.disposition==='acknowledge'&&candidate.corrections.some(c=>!before.corrections.some(old=>old.id===c.id&&old.text===c.text)))effective.reply='این اصلاح فقط پیشنهاد است؛ هنوز اعمال نشده.';
  if(execution.ignored.length){
    effective.operations=execution.applied;
    effective.memory.constraints=effective.memory.constraints.filter(c=>!execution.ignored.some(item=>c.target===item.target||c.target.startsWith(item.target+'/')));
  }
  if(execution.ignored.length&&!execution.applied.length&&!execution.problems.length){effective.disposition='unsupported';effective.reply='تنظیم خارج از محدوده اعمال نشد.';}
  const context={beforeTargets:templateTargets(before,assets),afterTargets:templateTargets(execution.state,assets),assets,newAssetIds:turn.assetIds||[],alreadyApplied:turn.event?.status==='applied',previousMemory};
  const outcome=assessDialogue(effective,context);
  const problems=[...new Set([...execution.problems.map(p=>p.code),...outcome.problems])];
  if(problems.length) {
    return {analysis:previous||before,dialogue:{...outcome.dialogue,memory:previousMemory||{goal:'',constraints:[]},question:null,reply:'تغییر اجرا نشد؛ دوباره امتحان کن.'},blocked:true,errorKind:'execution',problems,execution:{...execution,state:before,applied:[],changed:false},warnings,validation:{decision:effective,context,outcome}};
  }
  let analysis=executing&&effective.disposition!=='unsupported'?execution.state:(previous||before);
  if(execution.changed){
    const evidenceChanged=execution.mode==='initial'||execution.applied.some(op=>!op.target.startsWith('adjustments/')&&!op.target.startsWith('captions/')&&op.target!=='sequence/products');
    analysis={...analysis,uncertain:evidenceChanged?candidate.uncertain:before.uncertain,corrections:(execution.mode==='initial'?candidate.corrections:before.corrections).filter(c=>!analysis.captionEdits.some(edit=>edit.id===c.id))};
  }
  return {analysis,dialogue:outcome.dialogue,blocked:outcome.blocked,ignored:outcome.ignored||false,problems:[],execution,warnings:execution.mode==='initial'?warnings:[...new Set(execution.ignored.map(item=>item.reason))],validation:{decision:effective,context,outcome}};
}

export function recordWork(previous,{id,turn,turnId,revisionOf,result}) {
  const work=structuredClone(previous||{decisions:[],media:{},active:null});
  const priorActive=work.active;
  const status=result.errorKind?'failed':result.ignored?'ignored':result.blocked?'awaiting':result.execution.changed?'applied':'answered';
  const decision={id,turnId,request:turn.text||'فایل ارسال‌شده',status,revisionOf:revisionOf||null,targets:result.execution.applied.map(op=>op.target),ignored:result.execution.ignored||[]};
  work.decisions=[...(work.decisions||[]),decision].slice(-40);
  work.active=['awaiting','failed'].includes(status)?{...decision,request:work.active?.request||decision.request}:null;
  work.media??={};
  work.pendingQuestions??={};
  if(result.errorKind)for(const assetId of turn.assetIds||[])work.media[assetId]={use:'pending',target:'',decisionId:id};
  else for(const binding of result.dialogue?.mediaBindings||[])work.media[binding.assetId]={use:binding.use,target:binding.target,decisionId:id};
  if(result.ignored)for(const assetId of turn.assetIds||[])work.media[assetId]={use:'unused',target:'',decisionId:id};
  const pending=(result.dialogue?.mediaBindings||[]).filter(b=>b.use==='pending').map(b=>b.assetId);
  if(!result.errorKind&&result.dialogue?.question)for(const assetId of pending)work.pendingQuestions[assetId]={question:structuredClone(result.dialogue.question),request:turn.choice?(priorActive?.request||decision.request):(turn.text||priorActive?.request||decision.request),assetIds:pending};
  for(const assetId of Object.keys(work.pendingQuestions))if(work.media[assetId]?.use!=='pending')delete work.pendingQuestions[assetId];
  const remaining=remainingMediaQuestion(work);
  if(remaining&&!work.active)work.active={...(priorActive||decision),request:remaining.request,status:'awaiting'};
  return work;
}

export function remainingMediaQuestion(work) {
  return Object.entries(work?.pendingQuestions||{}).find(([assetId])=>work.media?.[assetId]?.use==='pending')?.[1]||null;
}
