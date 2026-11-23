import {act,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('./api',async original=>({...await original<typeof import('./api')>(),api:mocks.api}));
import {ApiError} from './api';
import {ResultPage} from './ResultPage';
import type {Job} from './types';
const queued:Job={id:'new-job',status:'queued',kind:'reel',createdAt:1};
beforeEach(()=>vi.clearAllMocks());
it('waits for the new job even when the parent job list has not refreshed',async()=>{
  let resolve!:(job:Job)=>void;mocks.api.mockImplementation(()=>new Promise<Job>(r=>resolve=r));
  render(<ResultPage id="new-job" jobs={[]} onChanged={()=>{}}/>);
  expect(screen.queryByText('این ویدیو پیدا نشد.')).toBeNull();
  expect(screen.getByRole('status')).toBeTruthy();
  await act(async()=>resolve(queued));expect(screen.getByText('ریلزت در حال ساخته')).toBeTruthy();
});
it('polls a queued job until its output is ready without depending on the job list',async()=>{
  mocks.api.mockResolvedValueOnce(queued).mockResolvedValue({...queued,status:'done',video:'/media/new-job/out.mp4'});
  vi.useFakeTimers();
  render(<ResultPage id="new-job" jobs={[]} onChanged={()=>{}}/>);
  await act(async()=>{});expect(screen.getByText('ریلزت در حال ساخته')).toBeTruthy();
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});vi.useRealTimers();
  expect(screen.getByRole('link',{name:'دانلود ویدیو'})).toBeTruthy();
});
it('shows genuine missing-job errors only after the server returns 404',async()=>{
  mocks.api.mockRejectedValue(new ApiError('missing',404));render(<ResultPage id="missing" jobs={[]} onChanged={()=>{}}/>);
  expect(screen.queryByText('این ویدیو پیدا نشد.')).toBeNull();await screen.findByText('این ویدیو پیدا نشد.');
});
it('keeps network errors distinct and supports retry',async()=>{
  mocks.api.mockRejectedValueOnce(new Error('ارتباط قطع شد')).mockResolvedValue(queued);
  render(<ResultPage id="new-job" jobs={[]} onChanged={()=>{}}/>);await screen.findByText('ارتباط قطع شد');
  expect(screen.queryByText('این ویدیو پیدا نشد.')).toBeNull();await userEvent.click(screen.getByRole('button',{name:'تلاش دوباره'}));
  await waitFor(()=>expect(screen.getByText('ریلزت در حال ساخته')).toBeTruthy());
});
