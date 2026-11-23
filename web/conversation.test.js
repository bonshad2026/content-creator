import {expect,it} from 'vitest';
import {conversationContext,assessDialogue,dialogueSchema} from '../src/conversation.js';
import {templateTargets} from '../src/template-conversation.js';
const target=(id,assetId)=>({id,label:id,refs:[`${assetId}:segment`],assetIds:[assetId]});
const assets=[{id:'old',name:'old.mp4',type:'video'},{id:'new',name:'new.mp4',type:'video'}];
const base={understanding:'تغییر بخش انتخاب‌شده',disposition:'apply',reply:'بخش انتخاب‌شده به‌روز شد.',memory:{goal:'هدف قبلی حفظ شود',constraints:[{id:'keep',text:'بقیهٔ بخش‌ها دست نخورند',target:''}]},question:null,mediaBindings:[{assetId:'new',target:'scene-b',use:'use',reason:'جایگزین'}],operations:[{type:'replace',target:'scene-b',assetIds:['new']}]};
it('normalizes model choice IDs while preserving their semantic references across revalidation',()=>{const raw={...base,disposition:'clarify',question:{text:'کدام بخش؟',choices:[{id:'products/product-1',label:'دومی'},{id:'محصول سوم',label:'سومی'},{label:'بخش دیگر'}]}};const parsed=dialogueSchema.parse(raw);expect(parsed.question.choices.map(c=>c.id)).toEqual(['choice-0','choice-1','choice-2']);expect(parsed.question.choices[0].value).toBe('products/product-1');expect(parsed.question.choices[1].value).toBe('محصول سوم');expect(dialogueSchema.parse(parsed)).toEqual(parsed);});
it('preserves assistant questions, attachment relationships, memory and pending choices',()=>{
  const e={assets,messages:[{role:'assistant',text:'جای کدام بخش؟',part:'question'},{role:'user',text:'همون دومی',assetIds:['new'],choice:{id:'b',questionId:'q'}}],dialogue:{memory:base.memory,question:{id:'q',text:'کدام بخش؟',choices:[{id:'b',label:'بخش دوم'}]}}};
  const context=conversationContext(e,{state:{title:'مستند'},targets:[target('scene-b','old')],capabilities:{replace:true}});
  expect(context.history[0].role).toBe('assistant');expect(context.currentTurn?.choice?.questionId).toBe('q');expect(context.currentTurn?.assetIds).toEqual(['new']);expect(context.memory).toEqual(base.memory);expect(context.media[1].uploadedIn).toContain(context.currentTurn?.id);
});
it.each(['scene-b','interview/answer','lesson/example'])('validates replacement independently of template or event: %s',id=>{
  const decision={...base,mediaBindings:[{...base.mediaBindings[0],target:id}],operations:[{type:'replace',target:id,assetIds:['new']}]};
  expect(assessDialogue(decision,{beforeTargets:[target(id,'old')],afterTargets:[target(id,'new')],assets,newAssetIds:['new']}).blocked).toBe(false);
});
it('blocks a claimed replacement that silently uses old evidence',()=>{
  const r=assessDialogue(base,{beforeTargets:[target('scene-b','old')],afterTargets:[{...target('scene-b','old'),label:'changed name'}],assets,newAssetIds:['new']});expect(r.blocked).toBe(true);expect(r.problems).toContain('replacement-not-applied');expect(r.errorKind).toBe('execution');expect(r.dialogue.question).toBeNull();
});
it('blocks no-op completion and ignored attachments',()=>{
  const r=assessDialogue({...base,mediaBindings:[],operations:[{type:'update',target:'scene-b',assetIds:[]}]},{beforeTargets:[target('scene-b','old')],afterTargets:[target('scene-b','old')],assets,newAssetIds:['new']});expect(r.problems).toContain('no-change');expect(r.problems).toContain('unresolved-attachment');
});
it('accepts an approval or memory-only turn without inventing another target question',()=>{const r=assessDialogue({...base,understanding:'کاربر متن فعلی را تأیید کرد',reply:'متن تأیید شد.',mediaBindings:[],operations:[]},{beforeTargets:[target('scene-b','old')],afterTargets:[target('scene-b','old')],assets});expect(r.blocked).toBe(false);expect(r.dialogue.disposition).toBe('acknowledge');expect(r.dialogue.question).toBeNull();});
it('lets the model ask a targeted question without guessing an attachment target',()=>{
  const decision={...base,disposition:'clarify',reply:'این فایل رو کدوم بخش بذارم؟',question:{text:'کدوم بخش؟',choices:[{id:'a',label:'بخش اول'},{id:'b',label:'بخش دوم'}]},mediaBindings:[{...base.mediaBindings[0],use:'pending'}],operations:[]};
  const r=assessDialogue(decision,{beforeTargets:[target('scene-b','old')],afterTargets:[target('scene-b','old')],assets,newAssetIds:[]});expect(r.blocked).toBe(true);expect(r.dialogue.question?.choices).toHaveLength(2);
});
it('answers informational questions without requiring an edit change',()=>{
  const r=assessDialogue({...base,disposition:'answer',operations:[],mediaBindings:[]},{beforeTargets:[target('scene-b','old')],afterTargets:[target('scene-b','old')],assets});expect(r.blocked).toBe(false);
});
it('distinguishes trusted UI changes from unapplied text requests',()=>{
  const r=assessDialogue({...base,operations:[],mediaBindings:[]},{beforeTargets:[],afterTargets:[],assets,alreadyApplied:true});expect(r.blocked).toBe(false);
});
it('automatically sets aside unsupported requests and preserves prior resolved context',()=>{const previousMemory={goal:'هدف قبلی',constraints:[]},r=assessDialogue({...base,disposition:'unsupported',reply:'این تغییر ممکن نیست؛ کنار گذاشتم.'},{beforeTargets:[target('scene-b','old')],afterTargets:[target('scene-b','new')],assets,previousMemory});expect(r.blocked).toBe(false);expect(r.ignored).toBe(true);expect(r.dialogue.question).toBeNull();expect(r.dialogue.memory).toEqual(previousMemory);});
it('keeps target identity stable when an earlier item is removed',()=>{
  const before={opening:[],closing:[],products:[{id:'a',name:'اول',speech:['old:segment'],visuals:[]},{id:'b',name:'دوم',speech:['new:segment'],visuals:[]}]};
  const items=assets.map(a=>({...a,segments:[{id:`${a.id}:segment`}],frames:[]}));
  const initial=templateTargets(before,items),after=templateTargets({...before,products:[before.products[1]]},items);
  expect(initial.find(t=>t.id==='products/b')).toEqual(after.find(t=>t.id==='products/b'));
  const result=assessDialogue({...base,mediaBindings:[],operations:[{type:'remove',target:'products/a',assetIds:[]}]},{beforeTargets:initial,afterTargets:after,assets});expect(result.blocked).toBe(false);
});
it('builds the real model request with full role/attachment context without calling AI',async()=>{
  const fs=await import('node:fs'),path=await import('node:path');
  const root=path.resolve('data/test-out');fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'conversation-dryrun-')),output=path.join(dir,'request.json'),previous=process.env.AI_DRYRUN;
  process.env.AI_DRYRUN=output;
  try{const {inspectTemplate}=await import('../src/ai.js');const edit={assets,messages:[{role:'assistant',text:'جای کدام بخش؟'},{role:'user',text:'همون دومی',assetIds:['new']}],dialogue:{memory:base.memory}};
    const context=conversationContext(edit,{state:{title:'درس'},targets:[target('lesson/example','old')],capabilities:{replace:true}});
    await expect(inspectTemplate(assets.map(a=>({...a,segments:[],frames:[]})),context,dir)).rejects.toMatchObject({dryRun:true});
    const request=JSON.parse(fs.readFileSync(output,'utf8')),payload=JSON.parse(request.content[0].text);
    expect(payload.context.history[0].role).toBe('assistant');expect(payload.context.currentTurn.assetIds).toEqual(['new']);expect(payload.context.memory).toEqual(base.memory);expect(request.system).toContain('Interpret a continuing conversation');
  }finally{if(previous===undefined)delete process.env.AI_DRYRUN;else process.env.AI_DRYRUN=previous;if(path.resolve(dir).startsWith(root+path.sep))fs.rmSync(dir,{recursive:true,force:true});}
});
