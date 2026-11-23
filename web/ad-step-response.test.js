import {expect,it,vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {AdSteps} from '../src/ad-scene.js';
it('retains the provider JSON before validation and recovers it without another request',async()=>{
  const dir=path.resolve('data/test-out/ad-json-response',crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'source.fixture');fs.writeFileSync(file,'offline image identity');
  const json=vi.fn(async()=>({data:{reason:'diagnostic '.repeat(100)},usage:{total_tokens:100}})),steps=new AdSteps(dir,'first',{json}),spec={system:'internal review',payload:{},images:[file]};
  await expect(steps.json('review',spec,z.object({reason:z.string().max(600)}))).rejects.toThrow();
  const recovered=await steps.json('review',spec,z.object({reason:z.string()}));expect(recovered.reason.length).toBeGreaterThan(600);expect(json).toHaveBeenCalledTimes(1);
});
