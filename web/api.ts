export const rel=(path:string)=>path.replace(/^\//,'');
export class ApiError extends Error {constructor(message:string,public status:number){super(message);this.name='ApiError';}}
export function getToken(){try{return localStorage.getItem('token')||'';}catch{return '';}}
export function setToken(token:string){try{token?localStorage.setItem('token',token):localStorage.removeItem('token');}catch{}}
export async function api<T>(path:string,{method='GET',body,signal,timeout=30000}:{method?:string;body?:unknown;signal?:AbortSignal;timeout?:number}={}):Promise<T>{
  const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
  const timer=setTimeout(()=>controller.abort('timeout'),timeout);
  try{
    const response=await fetch(rel(path),{method,credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json',...(getToken()?{'X-Creator-Token':getToken()}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const raw=await response.text();let data:any;try{data=JSON.parse(raw);}catch{throw new ApiError(response.status===401?'رمز ورود به نسخهٔ تست رو دوباره وارد کن.':response.status===404?'این عملیات روی نسخهٔ سرور در دسترس نیست.':'پاسخ سرور کامل دریافت نشد؛ دوباره تلاش کن.',response.status);}
    if(!response.ok){if(response.status===401){setToken('');window.dispatchEvent(new Event('creator:unauthorized'));}throw new ApiError(data.error||'درخواست انجام نشد؛ دوباره تلاش کن.',response.status);}
    return data as T;
  }catch(error){if(signal?.aborted)throw new DOMException('ارسال لغو شد.','AbortError');if(controller.signal.aborted)throw new ApiError('پاسخ سرور طول کشید؛ دوباره تلاش کن.',408);throw error instanceof Error?error:new Error('ارتباط برقرار نشد.');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export const fa=(n:number|string)=>String(n).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
export const size=(n:number)=>`${fa((n/1048576).toFixed(n<10485760?1:0))} مگابایت`;
export const clock=(n:number)=>`${fa(Math.floor((n||0)/60))}:${fa(String(Math.floor((n||0)%60)).padStart(2,'0'))}`;
export const message=(e:unknown)=>e instanceof Error?e.message:'مشکلی پیش اومد؛ دوباره تلاش کن.';
export const uid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
