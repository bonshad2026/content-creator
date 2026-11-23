import {expect,it} from 'vitest';
import {resolveEditTurn,recordWork,remainingMediaQuestion} from '../src/edit-turn.js';
import {executeChanges} from '../src/edit-changes.js';
import {selectionState} from '../src/template-changes.js';
import {conversationContext} from '../src/conversation.js';
const assets=['old','new'].map(id=>({id,type:'video',duration:12,segments:[0,1,2].map((n)=>({id:`${id}:s${n}`,start:n*2+.2,end:n*2+1,text:`گفتار ${n}`,words:[]})),frames:[{id:`${id}:f0`,start:0,t:1}]}));
const before=selectionState({opening:['old:s0'],closing:['old:s2'],products:[{id:'a',name:'اول',speech:['old:s1'],visuals:['old:f0']}],uncertain:false},assets);
const decision={understanding:'درخواست',disposition:'apply',reply:'تغییر اعمال شد.',memory:{goal:'ادیت',constraints:[]},question:null,mediaBindings:[],operations:[]};
const run=(proposal,dialogue={},turn={})=>resolveEditTurn({previous:before,assets,turn,proposal:{...structuredClone(proposal),dialogue:{...decision,...dialogue}}});
const op=(type,target,assetIds=[])=>({type,target,assetIds});
const replacement={...before,products:[{...before.products[0],visuals:['new:f0']}]};

it('writes only the declared scalar and preserves unrelated selection, name and sound',()=>{
  const r=run({...before,opening:[],products:[],adjustments:{fontSize:52,gainDb:6}},{operations:[op('update','adjustments/fontSize')]});
  expect(r.problems).toEqual([]);expect(r.analysis.adjustments.fontSize).toBe(52);expect(r.analysis.adjustments.gainDb).toBe(0);expect(r.analysis.opening).toEqual(before.opening);expect(r.analysis.products).toEqual(before.products);
});
it('does not revive recognition uncertainty or ASR suggestions during a settings-only edit',()=>{
  const r=run({...before,uncertain:true,corrections:[{id:'old:s1',text:'تغییر بی‌درخواست متن'}],adjustments:{fontSize:52}},{operations:[op('update','adjustments/fontSize')]});
  expect(r.analysis.uncertain).toBe(false);expect(r.analysis.corrections).toEqual([]);
});
it('replaces only picture ownership while preserving recorded speech and product identity',()=>{
  const r=run(replacement,{operations:[op('replace','products/a/visuals',['new'])],mediaBindings:[{assetId:'new',use:'use',target:'products/a/visuals',reason:'تصویر جایگزین'}]},{assetIds:['new']});
  expect(r.problems).toEqual([]);expect(r.analysis.products[0].speech).toEqual(['old:s1']);expect(r.analysis.products[0].visuals).toEqual(['new:f0']);
});
it('does not claim completion when the new file was left out of the executed target',()=>{
  const r=run(before,{operations:[op('replace','products/a/visuals',['new'])],mediaBindings:[{assetId:'new',use:'use',target:'products/a/visuals',reason:'جایگزین'}]},{assetIds:['new']});
  expect(r.errorKind).toBe('execution');expect(r.analysis).toEqual(before);expect(r.dialogue.question).toBeNull();expect(r.execution.applied).toEqual([]);
});
it('rolls back valid earlier operations if another operation references unavailable evidence',()=>{
  const bad={...replacement,adjustments:{fontSize:52},products:[{...replacement.products[0],visuals:['invented:f0']}]};
  const r=run(bad,{operations:[op('update','adjustments/fontSize'),op('replace','products/a/visuals',['new'])]});
  expect(r.errorKind).toBe('execution');expect(r.analysis).toEqual(before);expect(r.execution.applied).toEqual([]);
});
it('sets aside an impossible setting while committing a valid independent change',()=>{
  const r=run({...replacement,adjustments:{fontSize:400}},{operations:[op('update','adjustments/fontSize'),op('replace','products/a/visuals',['new'])]});
  expect(r.errorKind).toBeUndefined();expect(r.analysis.adjustments.fontSize).toBe(44);expect(r.analysis.products[0].visuals).toEqual(['new:f0']);expect(r.execution.ignored).toHaveLength(1);expect(r.execution.applied).toHaveLength(1);
});
it('ignores an entirely impossible setting without keeping it as a pending request',()=>{
  const r=run({...before,adjustments:{gainDb:80}},{operations:[op('update','adjustments/gainDb')]});
  expect(r.ignored).toBe(true);expect(r.blocked).toBe(false);expect(r.analysis).toEqual(before);
});
it('preserves a precise pending-file question and its accidental-upload option',()=>{
  const question={text:'این فایل برای کدام بخش است؟',choices:[{id:'products/a/speech',label:'گفتار اول'},{id:'none',label:'اشتباهی فرستادم'}]};
  const r=run({...before,products:[]},{disposition:'clarify',reply:'این فایل برای کدام بخش است؟',question,mediaBindings:[{assetId:'new',use:'pending',target:'products',reason:'هنوز مشخص نیست'}]},{assetIds:['new']});
  expect(r.problems).toEqual([]);expect(r.dialogue.question.choices.map(c=>c.label)).toEqual(['گفتار اول','اشتباهی فرستادم']);expect(r.analysis).toEqual(before);expect(r.blocked).toBe(true);
});
it('rejects an unaccounted attachment without inventing a user clarification question',()=>{
  const r=run(before,{disposition:'acknowledge'},{assetIds:['new']});
  expect(r.errorKind).toBe('execution');expect(r.dialogue.question).toBeNull();expect(r.problems).toContain('unresolved-attachment');
});
it.each(['answer','acknowledge','clarify','unsupported'])('never executes proposal values on a %s turn',disposition=>{
  const r=run(replacement,{disposition,question:disposition==='clarify'?{text:'کدام بخش؟',choices:[]}:null});expect(r.analysis).toEqual(before);expect(r.execution.applied).toEqual([]);
});
it('requires explicit changes after initial assembly instead of accepting a whole rewritten selection',()=>{
  const r=run(replacement);expect(r.problems).toContain('missing-operations');expect(r.analysis).toEqual(before);
});
it('acknowledges an unchanged approval without a physical edit operation',()=>{
  const r=run({...before,uncertain:true});expect(r.errorKind).toBeUndefined();expect(r.dialogue.disposition).toBe('acknowledge');expect(r.blocked).toBe(false);
});
it('supports explicit initial partial assembly while waiting for a missing part',()=>{
  const r=resolveEditTurn({previous:null,assets,turn:{assetIds:['old']},proposal:{...before,closing:[],dialogue:{...decision,disposition:'need_input',question:{text:'پایان ویدیو رو می‌فرستی؟',choices:[]},mediaBindings:[{assetId:'old',use:'use',target:'opening',reason:'شروع'}]}}});
  expect(r.errorKind).toBeUndefined();expect(r.analysis.opening).toEqual(['old:s0']);expect(r.blocked).toBe(true);expect(r.execution.mode).toBe('initial');
});
it('adds, reorders and removes stable slots without rewriting unaffected slots',()=>{
  const b={id:'b',name:'دوم',speech:['new:s1'],visuals:['new:f0']};
  const added=run({...before,products:[{...before.products[0],name:'بی‌درخواست'},b]},{operations:[op('append','products/b',['new'])]});
  expect(added.analysis.products[0]).toEqual(before.products[0]);expect(added.analysis.products[1]).toEqual(b);
  const ordered=resolveEditTurn({previous:added.analysis,assets,proposal:{...added.analysis,products:[b,{...before.products[0],name:'بی‌درخواست'}],dialogue:{...decision,operations:[op('update','sequence/products')]}}});
  expect(ordered.analysis.products.map(p=>p.id)).toEqual(['b','a']);expect(ordered.analysis.products[1].name).toBe('اول');
  const removed=resolveEditTurn({previous:ordered.analysis,assets,proposal:{...ordered.analysis,dialogue:{...decision,operations:[op('remove','products/a')]}}});
  expect(removed.analysis.products).toEqual([b]);
});
it('rejects overlapping parent/child writes instead of silently picking an order',()=>{
  const r=run(replacement,{operations:[op('update','products/a',['old','new']),op('update','products/a/visuals',['new'])]});
  expect(r.problems).toContain('overlapping-operations');expect(r.analysis).toEqual(before);
});
it.each(['lesson/example','interview/answer'])('executes generic transactions without template-specific events: %s',target=>{
  const adapter=(state,proposal,op)=>({state:{...state,[op.target]:proposal[op.target]}});
  const r=executeChanges({before:{[target]:'old',other:'keep'},proposal:{[target]:'new',other:'unrequested'},operations:[op('update',target)],adapter});
  expect(r.state).toEqual({[target]:'new',other:'keep'});
});
it('keeps a server-owned ledger of pending and ignored files independent of model memory',()=>{
  const waiting=run(before,{disposition:'clarify',question:{text:'کدام بخش؟',choices:[]},mediaBindings:[{assetId:'new',target:'',use:'pending',reason:'ابهام'}]},{assetIds:['new']});
  const work=recordWork(null,{id:'one',turnId:'message-1',turn:{text:'جایگزین کن',assetIds:['new']},revisionOf:'v1',result:waiting});
  expect(work.active.request).toBe('جایگزین کن');expect(work.media.new.use).toBe('pending');
  const ignored=run(before,{disposition:'answer',mediaBindings:[{assetId:'new',target:'',use:'unused',reason:'اشتباهی'}]});
  const next=recordWork(work,{id:'two',turnId:'message-2',turn:{text:'اشتباهی بود'},revisionOf:'v1',result:ignored});
  expect(next.active).toBeNull();expect(next.media.new.use).toBe('unused');expect(next.decisions).toHaveLength(2);expect(work.active).not.toBeNull();
});
it('limits model history to the selected revision branch while retaining original file provenance',()=>{
  const e={contextStart:2,work:{active:null,decisions:[],media:{}},assets,messages:[{role:'user',text:'نسخه قدیمی',assetIds:['old']},{role:'assistant',text:'سؤال نامرتبط قدیمی'},{role:'user',text:'اصلاح نسخه انتخابی'}]};
  const context=conversationContext(e,{state:before,targets:[],capabilities:{}});
  expect(context.history.map(m=>m.text)).toEqual(['اصلاح نسخه انتخابی']);expect(context.media[0].uploadedIn).toEqual(['message-0']);expect(context.work).toEqual(e.work);
});
it('does not lose a pending file question when a later independent setting change succeeds',()=>{
  const waiting=run(before,{disposition:'clarify',question:{text:'فایل برای کدام بخش است؟',choices:[{id:'none',label:'اشتباهی بود'}]},mediaBindings:[{assetId:'new',target:'',use:'pending',reason:'ابهام'}]},{assetIds:['new']});
  const work=recordWork(null,{id:'one',turnId:'1',turn:{text:'این فایل جایگزین شود'},result:waiting});
  const settings=run({...before,adjustments:{fontSize:52}},{operations:[op('update','adjustments/fontSize')]});
  const next=recordWork(work,{id:'two',turnId:'2',turn:{text:'فونت بزرگ‌تر'},result:settings});
  expect(next.decisions.at(-1).status).toBe('applied');expect(next.active.status).toBe('awaiting');expect(remainingMediaQuestion(next)?.question.text).toBe('فایل برای کدام بخش است؟');expect(remainingMediaQuestion(next)?.request).toBe('این فایل جایگزین شود');
});
