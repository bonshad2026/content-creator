// New-photo protocol end-to-end: synthetic artwork and explicitly mocked AI.
process.env.DATA_DIR='data/test-out/grounded-ad-tests';delete process.env.GAPGPT_API_KEY;
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const {designAd,deriveAdLayers,animateAdLayers}=await import('../src/ad-scene.js');
const {ffmpeg}=await import('../src/media.js');
const {inspectImageAsset}=await import('../src/image-assets.js');
const root=path.resolve(process.env.DATA_DIR,crypto.randomUUID());fs.mkdirSync(root,{recursive:true});
const source=path.join(root,'source.png'),product=path.join(root,'product.png'),accent=path.join(root,'accent.png');
await ffmpeg(['-f','lavfi','-i','color=c=0x233544:s=1024x1536','-frames:v','1','-update','1',source]);
await ffmpeg(['-f','lavfi','-i','color=c=0xe8d5bd:s=300x850,format=rgba,pad=1024:1536:362:350:color=black@0','-frames:v','1','-update','1',product]);
await ffmpeg(['-f','lavfi','-i','color=c=0x7b91f0:s=90x450,format=rgba,pad=1024:1536:810:400:color=black@0','-frames:v','1','-update','1',accent]);
const grounding=(form,factIds,surface=false)=>({form,factIds,userQuote:'',changesProductSurface:surface,rationale:'fixture evidence'});
const plan={decision:'ready',product:{name:'محصول جدید',confidence:.95,invariants:['preserve actual package geometry']},question:'',uncertainties:[],direction:{description:'leaked-extra-prop in scene',palette:'blue and neutral',lighting:'soft key',background:'leaked-extra-prop-filled studio',contact:''},accents:[
 {id:'accent-physical',role:'front',label:'عنصر واقعی',description:'unsupported physical object',grounding:grounding('physical_prop',['motif'])},
 {id:'accent-wet',role:'back',label:'اثر سطح',description:'unsupported surface change',grounding:grounding('material_effect',['surface'],true)},
 {id:'accent-misread',role:'front',label:'نقش انتزاعی',description:'abstract element perceived as an unintended object',grounding:grounding('abstract_graphic',['motif'])},
 {id:'accent-line',role:'back',label:'خط گرافیکی',description:'a nonrepresentational graphic line matching the package palette',grounding:grounding('abstract_graphic',['motif'])},
]};
let checks=0,imageCalls=0;const check=(s,f)=>{f();checks++;console.log('ok',s);};const prompts=[];
const providers={json:async spec=>{
 if(spec.system.startsWith('Observe'))return {data:{facts:[{id:'motif',kind:'graphic',description:'printed geometric pattern'},{id:'surface',kind:'material',description:'dry packaging'}],uncertainties:[]}};
 if(spec.system.startsWith('Check a proposed')){check('unsupported physical/surface accents are removed before semantic review',()=>assert.deepEqual(spec.payload.plan.accents.map(a=>a.id),['accent-misread','accent-line']));return {data:{sceneRelevant:true,approvedAccentIds:['accent-line','unknown-id'],reason:'one abstract element has a misleading association'}};}
 if(spec.system.includes('Review product-ad'))return {data:{semanticallyAppropriate:true,identityPreserved:true,layersSeparated:true,depthCorrect:true,compositionCoherent:true,invalidLayers:[],reason:''}};
 check('new source direction has observations and no prior-product state',()=>{assert(spec.payload.observations.facts.length);assert.equal(spec.payload.previous,null);});return {data:plan};
 },image:async spec=>{prompts.push(spec.prompt);imageCalls++;fs.copyFileSync(!spec.transparent?source:spec.prompt.includes('ONLY the subject layer')?product:accent,spec.output,fs.constants.COPYFILE_EXCL);return {usage:null};}};
plan.direction.contact='Soft contact shadow, without an invented reflection';
const designDir=path.join(root,'design'),assets=path.join(root,'assets');
const design=await designAd({source,dir:designDir,attempt:'new-photo',creativeProtocol:3,...providers});
fs.mkdirSync(assets,{recursive:true});
fs.writeFileSync(path.join(assets,'quality.json'),JSON.stringify({passed:false,invalidLayers:['contact'],attempt:'old-failed-attempt',reason:'duplicated product in generated contact'}));
check('only the approved evidenced accent reaches generation',()=>assert.deepEqual(design.plan.accents.map(a=>a.id),['accent-line']));
check('rejected props cannot leak through a free-form scene description/background',()=>assert(!prompts[0].includes('leaked-extra-prop')));
const scene=await deriveAdLayers({source,dir:assets,designDir,attempt:'new-photo',...providers});
check('new jobs actually select the choreographed renderer',()=>assert.equal(scene.motionProfile,'hero-reveal-v2'));
check('contact comes from actual subject alpha, never an image-generation request',()=>{
 assert(scene.layers.find(l=>l.role==='contact').file.startsWith('contact-local-'));
 assert(!prompts.some(p=>p.includes('ONLY the contact layer')));
});
const shadowIndex=scene.layers.findIndex(l=>l.role==='contact'),subjectIndex=scene.layers.findIndex(l=>l.role==='subject');
const subjectAlpha=await inspectImageAsset(path.join(assets,scene.layers[subjectIndex].file));
check('final framing anchors the actual product at the template floor',()=>assert(Math.abs(subjectAlpha.bounds.bottom-1320)<=2));
const callsBeforeResume=imageCalls;
await deriveAdLayers({source,dir:assets,designDir,attempt:'explicit-resume',...providers});
check('a retry reuses artwork and the deterministic contact without image charges',()=>assert.equal(imageCalls,callsBeforeResume));
await animateAdLayers(assets,scene);const motion=JSON.parse(fs.readFileSync(path.join(assets,'motion.json')));
check('the live render records a detail hook, assembly, push and end hold',()=>assert.equal(motion.beats.length,4));
check('contact follows the same entrance transform as the product',()=>{
 assert.equal(motion.tracks[shadowIndex].x,motion.tracks[subjectIndex].x);
 assert.equal(motion.tracks[shadowIndex].y,motion.tracks[subjectIndex].y);
});
check('no image is regenerated just to change motion',()=>assert.equal(imageCalls,4));
const frames=[];for(const t of [.25,1.5,4.9,5.8]){const file=path.join(root,`gray-${t}.raw`);await ffmpeg(['-ss',String(t),'-i',path.join(assets,'out.mp4'),'-frames:v','1','-f','rawvideo','-pix_fmt','gray',file]);frames.push(fs.readFileSync(file));}
const difference=(a,b)=>{let total=0;for(let i=0;i<a.length;i++)total+=Math.abs(a[i]-b[i]);return total/a.length;};
check('opening visibly changes the frame rather than barely drifting',()=>assert(difference(frames[0],frames[1])>5));
check('last second holds the resolved frame and does not fade to black',()=>{assert(difference(frames[2],frames[3])<1);assert(frames[3].reduce((a,b)=>a+b,0)/frames[3].length>10);});
await assert.rejects(deriveAdLayers({source,dir:path.join(root,'rejected-semantics'),designDir,attempt:'reject',...providers,json:async()=>({data:{semanticallyAppropriate:false,identityPreserved:true,layersSeparated:true,depthCorrect:true,compositionCoherent:true,invalidLayers:[],reason:'The appearance implies an unsupported property.'}})}),error=>error.code==='AD_QUALITY_REJECTED');
check('semantic mismatch blocks publication even when identity/geometry pass',()=>assert(!fs.existsSync(path.join(root,'rejected-semantics','out.mp4'))));
console.log(`${checks} grounded pipeline checks passed, zero paid calls`);
