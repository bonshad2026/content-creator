// Public wording belongs to the application, not the internal quality reviewer.
export const AD_QUALITY_REJECTED='AD_QUALITY_REJECTED';
export const AD_QUALITY_MESSAGE='پیش‌نمایش آماده نشد؛ دوباره امتحان کن.';
export const SERVICE_UNAVAILABLE_MESSAGE='پردازش موقتاً در دسترس نیست؛ بعداً دوباره تلاش کن.';
const quotaCodes=new Set(['insufficient_user_quota','insufficient_quota','insufficient_balance','pre_consume_token_quota_failed']);
const technical=/gapgpt|openai|anthropic|claude|api[ _-]?key|insufficient[_ -]|quota|billing|credit balance/i;
export function publicContentError(error){
 const code=error?.code||error?.errorCode,message=error?.publicMessage||error?.message||error?.error||'';
 if(quotaCodes.has(code)||technical.test(message))return SERVICE_UNAVAILABLE_MESSAGE;
 if(error?.publicMessage)return error.publicMessage;
 if(error?.status&&/[\u0600-\u06ff]/.test(message))return message;
 if(typeof error?.error==='string'&&/[\u0600-\u06ff]/.test(message))return message;
 return 'پردازش کامل نشد؛ فایل محفوظ است. دوباره تلاش کن.';
}
export function publicJobError(job){
  const message=job?.error||null;
  // Legacy persisted errors predate codes; redact projections without rewriting data.
  if(job?.errorCode===AD_QUALITY_REJECTED||typeof message==='string'&&message.startsWith('کیفیت لایه‌ها تأیید نشد.'))return AD_QUALITY_MESSAGE;
  if(quotaCodes.has(job?.errorCode)||typeof message==='string'&&technical.test(message))return SERVICE_UNAVAILABLE_MESSAGE;
  return message;
}
