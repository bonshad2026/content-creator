import {act,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Attachment} from './components/Attachment';
import {compressionStore} from './compression';
import {draftStore,repository} from './draft';
import type {LocalMedia} from './types';
let item:LocalMedia,finish!:(r:{file:File;original:boolean})=>void,options:{signal:AbortSignal;onProgress:(n:number)=>void};
beforeEach(async()=>{
  vi.spyOn(repository,'load').mockResolvedValue(null);vi.spyOn(repository,'meta').mockResolvedValue();vi.spyOn(repository,'file').mockResolvedValue();vi.spyOn(repository,'clear').mockResolvedValue();vi.spyOn(repository,'drop').mockResolvedValue();
  await draftStore.activate('compression-test','edit-compression');item={id:crypto.randomUUID(),type:'video',file:new File(['original payload'],'source.mp4',{type:'video/mp4'})};draftStore.add(item);
  window.MediaPrep={available:()=>true,compress:vi.fn((_file:File,o:{signal:AbortSignal;onProgress:(n:number)=>void})=>{options=o;return new Promise<{file:File;original:boolean}>(r=>finish=r);})};
});
afterEach(async()=>{compressionStore.cancel(item.id);finish?.({file:item.file,original:true});await Promise.resolve();await draftStore.flush();await draftStore.discard();delete window.MediaPrep;vi.restoreAllMocks();});
it('continues after attachment unmount, restores progress on return and stores result with original',async()=>{
  const first=render(<Attachment item={item} disabled={false} onError={()=>{}}/>);await userEvent.click(screen.getByRole('button',{name:'کاهش حجم · اختیاری'}));
  act(()=>options.onProgress(.37));first.unmount();expect(options.signal.aborted).toBe(false);
  render(<Attachment item={item} disabled={false} onError={()=>{}}/>);expect(screen.getByText(/37٪/)).toBeTruthy();
  const prepared=new File(['tiny'],'prepared.mp4',{type:'video/mp4'});await act(async()=>finish({file:prepared,original:false}));
  expect(draftStore.getSnapshot().pending[0].file).toBe(prepared);expect(draftStore.getSnapshot().pending[0].originalFile).toBe(item.file);
});
it('explicit cancel aborts and keeps the source even if the encoder resolves late',async()=>{
  const pending=compressionStore.start(item);compressionStore.cancel(item.id);expect(options.signal.aborted).toBe(true);finish({file:new File(['x'],'late.mp4'),original:false});await pending;
  expect(draftStore.getSnapshot().pending[0].file).toBe(item.file);
});
it('never attaches a late result to a different draft',async()=>{
  const pending=compressionStore.start(item);await draftStore.activate('compression-test','different-edit');expect(options.signal.aborted).toBe(true);
  finish({file:new File(['x'],'late.mp4'),original:false});await pending;expect(draftStore.getSnapshot().pending).toHaveLength(0);
});
it('rejects duplicate preparation of the same file',async()=>{
  const pending=compressionStore.start(item);await compressionStore.start(item);expect(window.MediaPrep?.compress).toHaveBeenCalledTimes(1);finish({file:item.file,original:true});await pending;
});
