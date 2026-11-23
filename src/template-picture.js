import {frameWindow,usablePicture} from './media-evidence.js';
export const pictureError=(code,message,extra={})=>Object.assign(new Error(message),{code,status:400,...extra});
export function productPictureRanges(product,assets) {
  const frames=new Map(assets.flatMap(a=>(a.frames||[]).map(f=>[f.id,{...f,asset:a}])));
  const explicit=product.visualRanges||[],selected=new Set(product.visuals);
  if(explicit.some(r=>!selected.has(r.frameId))||new Set(explicit.map(r=>r.frameId)).size!==explicit.length)throw pictureError('VISUAL_RANGE','بازهٔ نمای انتخاب‌شده معتبر نیست.');
  const intervals=[];
  for(const id of product.visuals) {
    const frame=frames.get(id);if(!frame)throw pictureError('VISUAL_RANGE','نمای انتخاب‌شده پیدا نشد.');
    const chosen=explicit.find(r=>r.frameId===id),bounds=chosen||frameWindow(frame,frame.asset);
    const {start,end}=bounds;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>frame.asset.duration+.001||end<=start||Number.isFinite(frame.t)&&(frame.t<start-.001||frame.t>end+.001)||chosen&&(start<(frame.shotStart??0)-.001||end>(frame.shotEnd??frame.asset.duration)+.001))throw pictureError('VISUAL_RANGE','بازهٔ نمای انتخاب‌شده معتبر نیست.');
    if(!usablePicture(frame.asset,start,end))throw pictureError('VISUAL_COVERAGE',`نمای روشن‌ترِ ${product.name} رو بفرست.`,{productId:product.id});
    const from=Math.ceil((start-1e-6)*30)/30,to=Math.floor((end+1e-6)*30)/30;
    if(to-from<1/30)continue;
    // Union overlapping source intervals: selecting the same shot twice cannot invent coverage.
    let current={assetId:frame.asset.id,start:from,end:to,frameIds:[id]};
    for(let i=intervals.length-1;i>=0;i--) {
      const other=intervals[i];
      if(other.assetId===current.assetId&&other.start<=current.end+.001&&current.start<=other.end+.001){current={...current,start:Math.min(current.start,other.start),end:Math.max(current.end,other.end),frameIds:[...other.frameIds,...current.frameIds]};intervals.splice(i,1);}
    }
    intervals.push(current);
  }
  return intervals;
}
export function pictureAllocator(product,assets) {
  const ranges=productPictureRanges(product,assets);let index=0,offset=0;
  return duration=>{
    const chunks=[];let left=duration;
    while(left>1e-5&&index<ranges.length) {
      const range=ranges[index],available=range.end-range.start-offset,take=Math.min(left,available);
      if(take>1e-5)chunks.push({videoAsset:range.assetId,videoIn:range.start+offset,duration:take,visualFrameIds:range.frameIds});
      offset+=take;left-=take;
      if(available-take<1e-5){index++;offset=0;}
    }
    if(left>1e-5)throw pictureError('VISUAL_COVERAGE',`برای ${product.name}، نمای طولانی‌تر یا گفتار کوتاه‌تر بفرست.`,{productId:product.id,missingSeconds:+left.toFixed(2)});
    return chunks;
  };
}
