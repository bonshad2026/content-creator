import {useEffect,useState} from 'react';
import {fa} from '../api';
export interface WorkProgress {stage:string;current?:number;total?:number;startedAt?:number}
const photoLabels:Record<string,string>={photo_reading:'در حال آماده‌سازی عکس',photo_layers:'در حال ساخت لایه‌های گرافیکی',photo_animating:'در حال متحرک‌سازی لایه‌ها',ad_understanding:'در حال شناخت محصول و طراحی صحنه',ad_relevance:'در حال بررسی تناسب عناصر با محصول',ad_master:'در حال روتوش و ساخت تصویر تبلیغاتی',ad_quality:'در حال بررسی کیفیت و هماهنگی لایه‌ها',ad_animating:'در حال متحرک‌سازی لایه‌ها'};
const labels:Record<string,string>={queued:'در انتظار شروع پردازش',reading_media:'در حال خواندن فایل',checking_media:'در حال بررسی تصویر و صدا',extracting_audio:'در حال استخراج صدا',extracting_frames:'در حال بررسی نماهای ویدیو',transcribing:'در حال استخراج متن گفتار',understanding_request:'در حال بررسی درخواستت',validating_changes:'در حال بررسی تغییرات',rendering:'در حال ساخت ویدیو',joining:'در حال ترکیب بخش‌های ویدیو',checking_output:'در حال بررسی خروجی',finalizing:'در حال آماده‌سازی خروجی'};
export function ProcessingStatus({progress,render=false}:{progress?:WorkProgress|null;render?:boolean}){
  const [now,setNow]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const step=progress?.stage|| (render?'queued':'understanding_request'),part=/^(?:rendering|ad_layers):(\d+)\/(\d+)$/.exec(step);
  const label=part?`در حال ساخت بخش ${fa(part[1])} از ${fa(part[2])}`:photoLabels[step]||labels[step]||(render?'در حال ساخت ویدیو':'در حال بررسی درخواستت');
  const elapsed=progress?.startedAt?Math.max(0,Math.floor((now-progress.startedAt)/1000)):0;
  return <div className="processing-status" role="status" aria-label={render?'در حال ساخت':'در حال بررسی'}><span className="typing-dots" aria-hidden="true"><i/><i/><i/></span><span className="processing-copy" aria-live="polite"><span className="processing-label" key={`${step}:${progress?.current||''}`}>{label}{progress?.total&&progress.current?` · فایل ${fa(progress.current)} از ${fa(progress.total)}`:''}</span><small aria-hidden="true">{elapsed>=5?`${fa(elapsed)} ثانیه گذشته`:'\u00a0'}</small></span></div>;
}
