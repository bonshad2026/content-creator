import {beforeEach,expect,it,vi} from 'vitest';
const fake=vi.hoisted(()=>({inspect:vi.fn()}));
vi.mock('../src/ai.js',()=>({demoMode:false,inspectTemplate:fake.inspect,transcribe:vi.fn()}));
import {analyzeEdit} from '../src/edit-analysis.js';
const decision={understanding:'بخش مشخص نیست',disposition:'clarify',reply:'کدام بخش؟',memory:{goal:'اصلاح',constraints:[]},question:{text:'کدام بخش؟',choices:[{id:'products/product-1',label:'بخش دوم'}]},mediaBindings:[],operations:[]};
const edit=()=>({messages:[{role:'user',text:'اون یکی رو عوض کن'}],assets:[{id:'v',name:'v.mp4',type:'video',duration:3,inspected:true,inspectionMode:'real',mediaEvidence:{version:1,black:[],shots:[],silences:[]},segments:[],frames:[]}]});
beforeEach(()=>{fake.inspect.mockReset();fake.inspect.mockResolvedValue({data:{opening:[],closing:[],products:[],dialogue:decision},usage:{tokens:40,cost:.01}});});
it('normalizes live-response choices and reuses the same response without a second model charge',async()=>{const e=edit(),usage=vi.fn();const first=await analyzeEdit(e,'unused',usage),second=await analyzeEdit(e,'unused',usage);expect(first.dialogue.question.choices[0]).toEqual({id:'choice-0',value:'products/product-1',label:'بخش دوم'});expect(second).toEqual(first);expect(fake.inspect).toHaveBeenCalledTimes(1);expect(usage.mock.calls.reduce((sum,[u])=>sum+(u.tokens||0),0)).toBe(40);});
it('invalidates cached analysis when the conversation actually changes',async()=>{const e=edit();await analyzeEdit(e,'unused');e.messages.push({role:'user',text:'منظورم بخش سومه'});await analyzeEdit(e,'unused');expect(fake.inspect).toHaveBeenCalledTimes(2);});
it('reports actual model and validation stages, but skips model work on a cached retry',async()=>{const e=edit(),progress=vi.fn();await analyzeEdit(e,'unused',()=>{},progress);expect(progress.mock.calls.map(([p])=>p.stage)).toEqual(['understanding_request','validating_changes']);progress.mockClear();await analyzeEdit(e,'unused',()=>{},progress);expect(progress.mock.calls.map(([p])=>p.stage)).toEqual(['validating_changes']);});
it('links a cached replay to its original trace and distinguishes it from a new provider response',async()=>{
  const e=edit(),first={id:'first-trace',record:vi.fn()},second={id:'second-trace',record:vi.fn()};
  await analyzeEdit(e,'unused',()=>{},()=>{},first);await analyzeEdit(e,'unused',()=>{},()=>{},second);
  expect(fake.inspect).toHaveBeenCalledTimes(1);expect(fake.inspect.mock.calls[0][3]).toBe(first);
  expect(second.record).toHaveBeenCalledWith('analysis.cache_hit',expect.objectContaining({sourceTraceId:'first-trace',data:expect.objectContaining({dialogue:decision})}));
  expect(first.record.mock.calls.some(([event])=>event==='analysis.normalized')).toBe(true);
});
