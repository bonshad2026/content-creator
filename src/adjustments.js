export const ADJUSTMENT_LIMITS=Object.freeze({fontSize:{min:32,max:64,default:44},gainDb:{min:-12,max:6,default:0},speed:{min:.75,max:1.25,default:1}});
export function normalizeAdjustments(raw,assets=[],previous){
  const value={fontSize:44,gainDb:0,speeds:{}},warnings=[];
  const ids=new Set(assets.flatMap(a=>(a.segments||[]).map(s=>s.id)));
  const apply=(input,warn)=>{if(input===undefined)return;if(!input||typeof input!=='object'||Array.isArray(input)){if(warn)warnings.push('تنظیمات نامعتبر اعمال نشدند.');return;}
    for(const key of Object.keys(input)){
      if(key==='speeds'){if(!input.speeds||typeof input.speeds!=='object'||Array.isArray(input.speeds)){if(warn)warnings.push('تنظیم سرعت نامعتبر اعمال نشد.');continue;}for(const [id,n]of Object.entries(input.speeds)){if(ids.has(id)&&Number.isFinite(n)&&n>=.75&&n<=1.25)value.speeds[id]=n;else if(warn)warnings.push('سرعت خارج از محدوده اعمال نشد.');}continue;}
      const limits=ADJUSTMENT_LIMITS[key];if(!['fontSize','gainDb'].includes(key)||!Number.isFinite(input[key])||input[key]<limits.min||input[key]>limits.max){if(warn)warnings.push(`${key==='fontSize'?'اندازهٔ فونت':key==='gainDb'?'بلندی صدا':'تنظیم درخواستی'} خارج از محدوده‌ست؛ اعمال نشد.`);continue;}
      value[key]=key==='fontSize'?Math.round(input[key]):input[key];
    }
  };
  apply(previous,false);apply(raw,true);return {value,warnings:[...new Set(warnings)]};
}
