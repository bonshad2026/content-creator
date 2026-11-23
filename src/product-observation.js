import {z} from 'zod';
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const product=z.object({name:z.string().min(1).max(100),brand:z.string().max(80),visibleText:z.array(z.string().max(300)).max(15)});
const base=z.object({products:product.array().max(8),certain:z.boolean(),question:z.string().max(160),choices:z.array(z.string().min(1).max(70)).max(4)});
const context=z.record(z.object({style:z.string().max(80),confidence:z.number().min(0).max(1),evidence:z.object({source:z.enum(['visible-label','user-input']),quote:z.string().max(300)}).nullable().optional()}));

// Convert equivalent response shapes, never fabricate missing product facts.
export function normalizeProductObservation(input,contextual=false){
 if(!record(input))return input;
 const out={...input};
 out.products=input.products==null?[]:Array.isArray(input.products)?input.products.map(p=>{
  if(!record(p))return p;
  const item={...p,brand:p.brand??'',visibleText:p.visibleText??[]};
  if(contextual&&item.fit==null)item.fit=p.compatible===true?'compatible':p.compatible===false?'incompatible':'uncertain';
  return item;
 }):input.products;
 out.question=input.question??'';out.choices=input.choices??[];
 if(input.certain==null)out.certain=false;
 if(!contextual)return out;
 const items=Array.isArray(out.products)?out.products.filter(record):[];
 if(out.compatible==null)out.compatible=items.some(p=>p.fit==='compatible');
 if(out.context==null){
  out.context={};
  const candidates=items.filter(p=>p.fit==='compatible');
  const keys=new Set(candidates.flatMap(p=>record(p.context)?Object.keys(p.context):[]));
  for(const key of keys){
   const values=candidates.map(p=>p.context?.[key]);
   if(values.every(v=>record(v))){
    if(values.every(v=>v.style===values[0].style)){
     if(values.length===1)out.context[key]={...values[0]};
     else if(values.every(v=>typeof v.confidence==='number'&&Number.isFinite(v.confidence)))out.context[key]={style:values[0].style,confidence:Math.min(...values.map(v=>v.confidence)),evidence:values.every(v=>JSON.stringify(v.evidence)===JSON.stringify(values[0].evidence))?values[0].evidence:null};
    }else out.context[key]={style:'uncertain',confidence:0,evidence:null};
   }
  }
 }
 return out;
}
export function productObservationSchema(contextual=false){
 const schema=contextual?base.extend({products:product.extend({fit:z.enum(['compatible','incompatible','uncertain'])}).array().max(8),compatible:z.boolean(),context}):base;
 return z.preprocess(v=>normalizeProductObservation(v,contextual),schema);
}
