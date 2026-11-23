// Read-only audit of existing local artifacts. No model calls, server mutations, or renders.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assessDialogue} from '../src/conversation.js';
import {templateTargets,templateFingerprint} from '../src/template-conversation.js';
import {validateEvidence,requirements,templateTimeline} from '../src/templates.js';

const root=path.resolve('data/test-out/template-ui-review');
const out=path.resolve('data/test-out/audit-2026-11-21');fs.mkdirSync(out,{recursive:true});
const bytes=fs.readFileSync(path.join(root,'db.json')),db=JSON.parse(bytes);
const e=db.edits.find(e=>e.id==='3PbPUHQTaM');if(!e?.analysisCache?.data)throw Error('Expected stored audit case not found');
const candidate=validateEvidence(e.analysisCache.data,e.assets,e.analysis?.adjustments);
const turn=e.messages.findLast(m=>m.role==='user');
const replay=assessDialogue(candidate.dialogue,{beforeTargets:templateTargets(e.analysis,e.assets),afterTargets:templateTargets(candidate,e.assets),assets:e.assets,newAssetIds:turn?.assetIds||[]});
const originalQuestion=candidate.dialogue.question;
const a=db.jobs.find(j=>j.id==='bjd1oCKvBZ'),b=db.jobs.find(j=>j.id==='VijQ3To2qj');
const j=db.jobs.find(j=>j.id==='h_W8Aql63C');
const product=j.templateData.analysis.products.find(p=>p.id==='sunglasses');
const timeline=JSON.parse(fs.readFileSync(path.join(root,'jobs',j.id,'timeline.json'),'utf8'));
const historicalFingerprint=job=>JSON.stringify({timeline:JSON.parse(fs.readFileSync(path.join(root,'jobs',job.id,'timeline.json'),'utf8')),caption:job.templateData.analysis.products.map(p=>p.name),adjustments:job.templateData.analysis.adjustments||{fontSize:44,gainDb:0,speeds:{}}});
let currentCoverageError;try{templateTimeline({opening:[],closing:[],products:[product]},j.templateData.assets);}catch(error){currentCoverageError=error.code;}
const clip=timeline.find(c=>product.speech.includes(c.segmentId));
const frame=j.templateData.assets.flatMap(a=>(a.frames||[]).map(f=>({...f,assetId:a.id,duration:a.duration}))).find(f=>f.id===product.visuals[0]);
const owner=e.userId,edits=db.edits.filter(x=>x.userId===owner),jobs=db.jobs.filter(x=>x.userId===owner);
const report={
  createdAt:new Date().toISOString(),mode:'offline audit, no AI requests',databaseSha256:createHash('sha256').update(bytes).digest('hex'),
  coverage:{chats:edits.length,userTurns:edits.reduce((n,e)=>n+e.messages.filter(m=>m.role==='user').length,0),completedJobs:jobs.filter(j=>j.status==='done').length,editsWithLatestModelCache:edits.filter(e=>e.analysisCache).length},
  sourceHashes:Object.fromEntries(['src/conversation.js','src/templates.js','src/template-conversation.js','src/template-render.js','src/ai.js'].map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')])),
  cases:[
    {id:'clarification-destroyed',editId:e.id,problems:replay.problems,model:{reply:candidate.dialogue.reply,question:originalQuestion},delivered:{reply:replay.dialogue.reply,question:replay.dialogue.question},acceptance:{preservesRelevantQuestion:replay.dialogue.question.text===originalQuestion.text,preservesRelevantSpeechChoice:replay.dialogue.question.choices.some(c=>c.label==='گفتار عینک آفتابی'),preservesAccidentalUploadChoice:replay.dialogue.question.choices.some(c=>c.label==='هیچ‌کدام؛ اشتباهی فرستادم')}},
    {id:'historical-unchanged-revision',jobs:[a.id,b.id],sameTimeline:fs.readFileSync(path.join(root,'jobs',a.id,'timeline.json'),'utf8')===fs.readFileSync(path.join(root,'jobs',b.id,'timeline.json'),'utf8'),sameFingerprint:historicalFingerprint(a)===historicalFingerprint(b),historicalOnly:true,note:'Current render route has since gained a no-op fingerprint guard; exact historical model response is unavailable.'},
    {id:'black-picture-fallback',jobId:j.id,selectedVisualFrame:frame.id,selectedVisualAvailableSeconds:frame.duration-frame.start,sourceSeconds:clip.sourceOut-clip.sourceIn,actualVideoAsset:clip.videoAsset,requestedVideoAsset:frame.assetId,outputRange:[clip.start,clip.end],requirementsPass:requirements(j.templateData.analysis,j.templateData.assets,true).every(r=>r.done),acceptance:{usesSelectedPicture:clip.videoAsset===frame.assetId},currentCompilerRejects:currentCoverageError==='VISUAL_COVERAGE',note:'Independent FFmpeg blackdetect measured output 14.632–24.732s and raw selected speech video 0–16.092s; screenshot is glasses-output-18s.jpg.'},
  ],
};
const reportFile=path.join(out,fs.existsSync(path.join(out,'baseline.json'))?'current-comparison.json':'baseline.json');
fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
const fixtureFile=path.join(out,'private-replay-fixture.json');
if(!fs.existsSync(fixtureFile))fs.writeFileSync(fixtureFile,JSON.stringify({edit:{analysis:e.analysis,assets:e.assets,messages:e.messages,raw:e.analysisCache.data},jobs:[a,b,j]},null,2));
console.log(JSON.stringify({coverage:report.coverage,cases:report.cases.map(c=>({id:c.id,acceptance:c.acceptance,sameFingerprint:c.sameFingerprint})),output:reportFile},null,2));
