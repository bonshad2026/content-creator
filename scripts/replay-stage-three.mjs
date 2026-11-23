// Read existing raw media for local technical checks. Never render user footage or call AI.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareMediaEvidence} from '../src/media-evidence.js';
import {templateTimeline,requirements} from '../src/templates.js';
const root=path.resolve('data/test-out/audit-2026-11-21'),bytes=fs.readFileSync(path.join(root,'private-replay-fixture.json'));
const fixture=JSON.parse(bytes),job=fixture.jobs.find(j=>j.id==='h_W8Aql63C');
const assets=structuredClone(job.templateData.assets),product=structuredClone(job.templateData.analysis.products.find(p=>p.id==='sunglasses'));
const dir=path.resolve('data/test-out/template-ui-review/jobs',job.id),output=path.join(dir,'out.mp4');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),before=hash(output);
const selected=assets.filter(a=>a.segments?.some(s=>product.speech.includes(s.id))||a.frames?.some(f=>product.visuals.includes(f.id)));
await prepareMediaEvidence(selected,dir);
const analysis={opening:[],closing:[],products:[product],uncertain:false};
let error;
try{templateTimeline(analysis,assets);}catch(e){error=e;}
assert.equal(error?.code,'VISUAL_COVERAGE');assert(error.missingSeconds>0);
assert(requirements(analysis,assets,true).some(r=>r.id==='coverage-0'&&!r.done));
const voice=selected.find(a=>a.segments.some(s=>product.speech.includes(s.id)));
assert(voice.mediaEvidence.black.some(([a,b])=>a<.1&&b>15));
assert.equal(voice.segments.find(s=>product.speech.includes(s.id)).timingStatus,'uncertain');
assert.equal(hash(output),before);
const report={at:new Date().toISOString(),mode:'local source inspection and plan replay; no AI or user render',fixtureSha256:createHash('sha256').update(bytes).digest('hex'),case:'black-picture-fallback',passed:true,checks:{insufficientSelectedPictureRejected:true,noSpeechVideoFallback:true,requirementsPreventBuild:true,blackSpeechPictureDetected:true,uncertainWordTimingExposed:true,existingUserOutputUnchanged:true},missingSelectedSourceSeconds:error.missingSeconds,sourceBlackSpans:voice.mediaEvidence.black,limits:'Technical correctness only; does not prove product recognition, ASR accuracy, healthy-take selection, or real-model comprehension.'};
fs.writeFileSync(path.join(root,'stage-3.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
