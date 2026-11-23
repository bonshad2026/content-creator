import {beforeAll,beforeEach,afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ffmpeg} from '../src/media.js';
import {editImageAsset,inspectImageAsset,downloadImageAsset} from '../src/image-assets.js';
const root=path.resolve('data/test-out/image-asset-contracts');fs.mkdirSync(root,{recursive:true});
// Generate tiny fixtures locally; no dependency on a previous manual pilot.
const png=path.join(root,'transparent-fixture.png'),opaque=path.join(root,'opaque-fixture.png');
beforeAll(async()=>{
  await ffmpeg(['-f','lavfi','-i','color=c=red@0.5:s=64x64,format=rgba,pad=96:96:16:16:color=black@0','-frames:v','1','-update','1',png]);
  await ffmpeg(['-f','lavfi','-i','color=c=blue:s=96x96','-frames:v','1','-update','1',opaque]);
});
let fetchMock,output;
beforeEach(()=>{vi.stubEnv('GAPGPT_API_KEY','offline-test-only');vi.stubEnv('GAPGPT_BASE_URL','https://provider.invalid/v1');fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);const testRoot=path.join(root,crypto.randomUUID());fs.mkdirSync(testRoot,{recursive:true});output=path.join(testRoot,'asset.png');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('sends a single product photo with the requested 4:5 size and unchanged prompt',async()=>{
  fetchMock.mockResolvedValue(new Response(JSON.stringify({data:[{b64_json:fs.readFileSync(opaque).toString('base64')}]}),{status:200}));
  await editImageAsset({inputs:[opaque],prompt:'Exact single-photo prompt',output,transparent:false,size:'1024x1280'});
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const form=fetchMock.mock.calls[0][1].body;
  expect(form.getAll('image[]')).toHaveLength(1);
  expect(form.get('prompt')).toBe('Exact single-photo prompt');
  expect(form.get('size')).toBe('1024x1280');
  expect(JSON.parse(fs.readFileSync(output+'.request.json','utf8')).size).toBe('1024x1280');
});
it('sends actual reference files, model and native transparency through the edit endpoint exactly once',async()=>{
  fetchMock.mockResolvedValue(new Response(JSON.stringify({data:[{b64_json:fs.readFileSync(png).toString('base64')}],usage:{total_tokens:99}}),{status:200}));
  const r=await editImageAsset({inputs:[png,opaque],prompt:'Reference-aligned product cutout',output});
  expect(fetchMock).toHaveBeenCalledTimes(1);const [url,options]=fetchMock.mock.calls[0];
  expect(url).toBe('https://provider.invalid/v1/images/edits');expect(options.body.get('background')).toBe('transparent');expect(options.body.get('output_format')).toBe('png');expect(options.body.getAll('image[]')).toHaveLength(2);
  expect(r.usage.total_tokens).toBe(99);const receipt=JSON.parse(fs.readFileSync(output+'.request.json','utf8'));expect(receipt.alpha.hasMeaningfulTransparency).toBe(true);expect(JSON.stringify(receipt)).not.toContain('offline-test-only');
  await expect(editImageAsset({inputs:[png],prompt:'again',output})).rejects.toThrow('already exists');expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('retains the request receipt and never silently resends an ambiguous or failed generation',async()=>{
  fetchMock.mockRejectedValue(Error('timeout'));
  await expect(editImageAsset({inputs:[png],prompt:'edit',output})).rejects.toThrow('timeout');
  await expect(editImageAsset({inputs:[png],prompt:'edit',output})).rejects.toThrow();expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fs.readFileSync(output+'.request.json','utf8')).status).toBe('failed');
});
it('rejects an opaque PNG rather than pretending it is a transparent layer',async()=>{
  fetchMock.mockResolvedValue(new Response(JSON.stringify({data:[{b64_json:fs.readFileSync(opaque).toString('base64')}]}),{status:200}));
  await expect(editImageAsset({inputs:[opaque],prompt:'transparent',output})).rejects.toThrow('without usable alpha');expect(fs.existsSync(output)).toBe(true);
  expect((await inspectImageAsset(output)).hasMeaningfulTransparency).toBe(false);
});
it('refuses private/direct-IP/unsecured image delivery before accessing the network',async()=>{
  for(const url of ['https://127.0.0.1/image.png','https://[::1]/image.png','http://cdn.invalid/image.png','https://secret@cdn.invalid/image.png'])await expect(downloadImageAsset(url)).rejects.toThrow('Unsafe');
  expect(fetchMock).not.toHaveBeenCalled();
});
it('resumes a saved CDN delivery across attempts without another paid generation',async()=>{
  fetchMock.mockResolvedValue(new Response(JSON.stringify({data:[{url:'https://cdn.example.test/asset.png'}],usage:{total_tokens:20}}),{status:200}));
  const download=vi.fn().mockRejectedValueOnce(Error('Image download timed out')).mockResolvedValueOnce(fs.readFileSync(png)),onGeneration=vi.fn();
  await expect(editImageAsset({inputs:[png],prompt:'same layer',output,download,onGeneration})).rejects.toMatchObject({code:'AD_ASSET_DOWNLOAD_FAILED'});
  const saved=JSON.parse(fs.readFileSync(output+'.request.json','utf8'));expect(saved.assetUrl).toBe('https://cdn.example.test/asset.png');expect(saved.phase).toBe('download');
  const resumed=await editImageAsset({inputs:[png],prompt:'same layer',output:output+'.retry.png',download,onGeneration});
  expect(resumed.generated).toBe(false);expect(fetchMock).toHaveBeenCalledTimes(1);expect(download).toHaveBeenCalledTimes(2);expect(onGeneration).toHaveBeenCalledTimes(1);
});
it('does not reuse a saved delivery belonging to another goal',async()=>{
  const download=vi.fn().mockRejectedValue(Error('temporary download problem'));
  fetchMock.mockImplementation(async()=>new Response(JSON.stringify({data:[{url:'https://cdn.example.test/asset.png'}]}),{status:200}));
  await expect(editImageAsset({inputs:[png],prompt:'first goal',output,download})).rejects.toThrow();
  await expect(editImageAsset({inputs:[png],prompt:'different goal',output:output+'.different.png',download})).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
