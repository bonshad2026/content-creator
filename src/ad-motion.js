// Template motion: explicit entrance, staggered depth assembly, camera push and hold.
// This renderer consumes existing assets only; it never generates product imagery.
import fs from 'node:fs';
import path from 'node:path';
import {ffmpeg,probe} from './media.js';
const progress=(start,duration,speed)=>`clip((t*${speed}-${start})/${duration},0,1)`;
const cubic=p=>`(1-pow(1-(${p}),3))`;
const back=p=>`(1+2.70158*pow((${p})-1,3)+1.70158*pow((${p})-1,2))`;
export function motionStudyGraph(scene){
  const speed=Math.min(1.5,Math.max(.5,scene.motion?.speed||1)),strength=Math.min(1.5,Math.max(.5,scene.motion?.strength||1));
  let backIndex=0,frontIndex=0;const graph=[],tracks=[];
  scene.layers.forEach((layer,i)=>{
    let start=0,duration=.8,x='0',y='0',angle='0',opacity=.35;
    if(layer.role==='subject'||layer.role==='contact'){
      start=0;duration=1;opacity=.01;const e=back(progress(start,duration,speed));y=`${65*strength}*(1-${e})`;angle=`-0.075*(1-${e})`;
    }else if(layer.role==='back'){
      const n=backIndex++;start=.35+n*.22;duration=1.05;opacity=.6;const e=cubic(progress(start,duration,speed)),sign=n%2?-1:1;
      x=`${sign*95*strength}*(1-${e})`;y=`${110*strength}*(1-${e})`;angle=`${sign*.055}*(1-${e})`;
    }else if(layer.role==='front'){
      const n=frontIndex++;start=.8+n*.2;duration=1;opacity=.6;const e=cubic(progress(start,duration,speed)),sign=n%2?-1:1;
      x=`${sign*140*strength}*(1-${e})`;y=`${-70*strength}*(1-${e})`;angle=`${-sign*.075}*(1-${e})`;
    }
    const fade=layer.role==='background'?'':`,fade=t=in:st=${start/speed}:d=${opacity/speed}:alpha=1`;
    graph.push(`[${i}:v]scale=854:1280,crop=720:1280,format=rgba,rotate=angle='${angle}':ow=iw:oh=ih:c=none${fade}[l${i}]`);
    tracks.push({id:layer.id,role:layer.role,start:start/speed,settled:(start+duration)/speed,x,y});
  });
  let last='l0';for(let i=1;i<scene.layers.length;i++){graph.push(`[${last}][l${i}]overlay=x='${tracks[i].x}':y='${tracks[i].y}':shortest=1:format=auto[c${i}]`);last=`c${i}`;}
  // Opaque camera transform only after compositing, so alpha stays intact above.
  const zoom="1.6-0.22*min(on/24,1)-0.38*(1-pow(1-clip((on-24)/42,0,1),3))+0.06*clip((on-96)/48,0,1)";
  graph.push(`[${last}]format=yuv420p,zoompan=z='${zoom}':x='(iw-iw/zoom)*(0.38+0.12*min(on/66,1))':y='(ih-ih/zoom)*(0.53-0.03*min(on/66,1))':d=1:s=720x1280:fps=30[out]`);
  return {graph:graph.join(';'),tracks,beats:[{name:'product detail hook',start:0,end:.8},{name:'pull back and depth assembly',start:.35,end:2.2},{name:'hero push',start:3.2,end:4.8},{name:'final hold',start:4.8,end:6}]};
}
export async function renderAdMotion(inputDir,outputDir,scene){
  fs.mkdirSync(outputDir,{recursive:true});if(!scene.layers.length||scene.layers[0].role!=='background')throw Error('Motion needs a background first');
  const timeline=motionStudyGraph(scene);fs.writeFileSync(path.join(outputDir,'motion.json'),JSON.stringify(timeline,null,2));
  const args=scene.layers.flatMap(l=>['-loop','1','-framerate','30','-i',path.join(inputDir,l.file)]),output=path.join(outputDir,'out.mp4');
  try{await ffmpeg([...args,'-filter_complex_threads','1','-filter_complex',timeline.graph,'-map','[out]','-an','-t','6','-c:v','libx264','-threads','2','-preset','fast','-crf','20','-maxrate','4500k','-bufsize','9000k','-movflags','+faststart',output]);
  const m=await probe(output);if(m.width!==720||m.height!==1280||Math.abs(m.duration-6)>.1||fs.statSync(output).size>5*1024*1024)throw Error('Motion output is invalid');return output;}
  catch(error){fs.rmSync(output,{force:true});throw error;}
}
// Earlier local studies used this name; retain their CLI import compatibility.
export const renderMotionStudy=renderAdMotion;
