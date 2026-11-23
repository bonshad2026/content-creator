import {describe,it,expect,vi} from 'vitest';
import {readBlob,fingerprint} from './upload';
describe('bounded and cancellable file preparation',()=>{
  it('reads actual selected file bytes',async()=>{const ctl=new AbortController();const bytes=await readBlob(new Blob(['abc']),ctl.signal);expect([...new Uint8Array(bytes)]).toEqual([97,98,99]);});
  it('cancels preparation without waiting for a file read',async()=>{const ctl=new AbortController();ctl.abort();await expect(readBlob(new Blob(['a']),ctl.signal)).rejects.toHaveProperty('name','AbortError');});
  it('fails visibly if a mobile file read never completes',async()=>{vi.useFakeTimers();class HungReader{readyState=1;readAsArrayBuffer(){}abort(){}}vi.stubGlobal('FileReader',HungReader);try{const promise=readBlob(new Blob(['x']),new AbortController().signal,50);const assertion=expect(promise).rejects.toThrow('خواندن فایل طول کشید');await vi.advanceTimersByTimeAsync(51);await assertion;}finally{vi.unstubAllGlobals();}});
  it('keeps resumable file identity stable across retry',async()=>{const file=new File(['same-content'],'clip.mp4',{lastModified:1000});expect(await fingerprint(file,new AbortController().signal)).toBe(await fingerprint(file,new AbortController().signal));});
});
