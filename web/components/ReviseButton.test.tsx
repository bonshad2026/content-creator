import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('../api',async original=>({...await original<typeof import('../api')>(),api:mocks.api}));
import {ReviseButton} from './ReviseButton';
beforeEach(()=>vi.clearAllMocks());
it('requires a request and starts analysis only after explicit submit',async()=>{
  const ready=vi.fn();mocks.api.mockResolvedValue({id:'edit-1'});
  render(<ReviseButton editId="edit-1" jobId="job-1" onReady={ready}/>);
  await userEvent.click(screen.getByRole('button',{name:'اصلاح این نسخه'}));
  expect(mocks.api).not.toHaveBeenCalled();
  expect((screen.getByRole('button',{name:'ادامه در چت'}) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.type(screen.getByLabelText('درخواست اصلاح'),'نمای محصول دوم اشتباهه');
  await userEvent.click(screen.getByRole('button',{name:'ادامه در چت'}));
  await waitFor(()=>expect(ready).toHaveBeenCalledWith({id:'edit-1'}));
  expect(mocks.api).toHaveBeenCalledWith('/api/edits/edit-1/revise',{method:'POST',body:{jobId:'job-1',text:'نمای محصول دوم اشتباهه'}});
});
it('preserves the request and shows errors instead of losing user input',async()=>{
  mocks.api.mockRejectedValue(new Error('اول پیش‌نویس فعلی رو تکمیل کن'));
  render(<ReviseButton editId="edit-1" jobId="job-1" onReady={vi.fn()}/>);
  await userEvent.click(screen.getByRole('button',{name:'اصلاح این نسخه'}));
  await userEvent.type(screen.getByLabelText('درخواست اصلاح'),'اصلاح نما');
  await userEvent.click(screen.getByRole('button',{name:'ادامه در چت'}));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('درخواست اصلاح') as HTMLTextAreaElement).value).toBe('اصلاح نما');
});
