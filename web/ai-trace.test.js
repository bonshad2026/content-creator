import {afterAll,afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const fake=vi.hoisted(()=>({completion:vi.fn(),speech:vi.fn()}));
vi.mock('openai',()=>({default:class {chat={completions:{create:fake.completion}};audio={transcriptions:{create:fake.speech}};}}));
vi.stubEnv('GAPGPT_API_KEY','offline-fake-secret-never-a-live-key');
vi.stubEnv('DATA_DIR','data/test-out/provider-trace-tests');
vi.stubEnv('AI_DRYRUN','');
const {inspectTemplate,transcribe}=await import('../src/ai.js');
const {createEditTrace,readEditTrace}=await import('../src/edit-trace.js');
const root=path.resolve('data/test-out/provider-trace-tests'),dir=path.join(root,'fixtures');
fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'frame.jpg'),Buffer.from([1,2,3,4]));fs.writeFileSync(path.join(dir,'voice.wav'),'offline speech bytes');
const assets=[{id:'v',type:'video',duration:3,segments:[],frames:[{id:'v:f0',start:0,t:1,file:'frame.jpg'}]}];
const create=()=>createEditTrace({editId:'mock-provider',kind:'analysis'},{root});
const events=t=>readEditTrace('mock-provider',t.id,{root,hydrate:true});
const response=(text,finish='stop')=>({id:'mock-response',model:'offline',choices:[{finish_reason:finish,message:{role:'assistant',content:text}}],usage:{total_tokens:5,cost:0}});
afterEach(()=>{fake.completion.mockReset();fake.speech.mockReset();delete process.env.AI_DRYRUN;});
afterAll(()=>vi.unstubAllEnvs());

it('records the actual assembled multimodal request and unmodified raw response with a mocked SDK',async()=>{
  const raw=response('{"opening":[],"products":[],"closing":[]}');fake.completion.mockResolvedValueOnce(raw);
  const t=create(),result=await inspectTemplate(assets,{currentTurn:{text:'این نما',assetIds:['v']}},dir,t),recorded=events(t);
  expect(recorded.find(e=>e.type==='model.request').data.request).toEqual(fake.completion.mock.calls[0][0]);
  expect(recorded.find(e=>e.type==='model.response').data.response).toEqual(raw);
  expect(recorded.find(e=>e.type==='model.parsed').data.data).toEqual(result.data);
  expect(fake.completion).toHaveBeenCalledTimes(1);
});

it('keeps both failed parsing and the existing retry without adding provider calls',async()=>{
  fake.completion.mockResolvedValueOnce(response('{','length')).mockResolvedValueOnce(response('{"ok":true}'));
  const t=create();await inspectTemplate(assets,{},dir,t);
  const requests=events(t).filter(e=>e.type==='model.request');
  expect(requests.map(e=>[e.data.attempt,e.data.request.max_tokens])).toEqual([[1,3600],[2,5400]]);
  expect(events(t).filter(e=>e.type==='model.response')).toHaveLength(2);
  expect(fake.completion).toHaveBeenCalledTimes(2);
});

it('records provider errors without retrying or logging the key inside an error message',async()=>{
  fake.completion.mockRejectedValueOnce(Object.assign(Error(`mock failed ${process.env.GAPGPT_API_KEY}`),{status:429}));
  const t=create();await expect(inspectTemplate(assets,{},dir,t)).rejects.toThrow('mock failed');
  const error=events(t).find(e=>e.type==='model.error').data.error;
  expect(error.status).toBe(429);expect(error.message).toBe('mock failed [REDACTED]');
  expect(fake.completion).toHaveBeenCalledTimes(1);
});

it('records speech file identity, config and raw confidence before normalization',async()=>{
  const raw={language:'fa',duration:1,segments:[{start:0,end:1,text:' سلام ',no_speech_prob:.1,avg_logprob:-.2}],words:[{start:.1,end:.5,word:'سلام'}]};
  fake.speech.mockImplementationOnce(async request=>{for await(const _chunk of request.file){}return raw;});
  const t=create(),result=await transcribe(path.join(dir,'voice.wav'),'fa',t),recorded=events(t);
  expect(recorded.find(e=>e.type==='speech.request').data.request).toMatchObject({model:'whisper-1',language:'fa',file:{bytes:20}});
  expect(recorded.find(e=>e.type==='speech.response').data.response).toEqual(raw);
  expect(result.segments[0]).toMatchObject({text:'سلام',noSpeech:.1,logprob:-.2});
  expect(fake.speech).toHaveBeenCalledTimes(1);
});

it('still returns the same provider result when trace storage is unavailable',async()=>{
  const t=createEditTrace({editId:'../invalid',kind:'analysis'},{root,onError:()=>{}});
  fake.completion.mockResolvedValueOnce(response('{"ok":true}'));
  await expect(inspectTemplate(assets,{},dir,t)).resolves.toMatchObject({data:{ok:true}});
  expect(fake.completion).toHaveBeenCalledTimes(1);
});

it('dry-run tracing never invokes the provider',async()=>{
  process.env.AI_DRYRUN=path.join(dir,'dry-run.json');const t=create();
  await expect(inspectTemplate(assets,{},dir,t)).rejects.toMatchObject({dryRun:true});
  expect(events(t).some(e=>e.type==='model.dry_run')).toBe(true);
  expect(fake.completion).not.toHaveBeenCalled();
});
