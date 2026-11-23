let controller, resultUrl;
document.getElementById("cancel").onclick=()=>controller?.abort();
document.getElementById("start").onclick=()=>run(document.getElementById("file").files[0]);
document.getElementById("fixture").onclick=async()=>{const r=await fetch("_compression-fixture.mp4");if(!r.ok)return;run(new File([await r.blob()],"fixture.mp4",{type:"video/mp4"}));};
async function run(file){
  if(!file)return;
  const status=document.getElementById("status"),start=document.getElementById("start"),cancel=document.getElementById("cancel");
  controller=new AbortController();start.disabled=true;cancel.hidden=false;
  const began=performance.now();
  try{const result=await MediaPrep.compress(file,{signal:controller.signal,onProgress:p=>status.textContent=`در حال تبدیل: ${Math.round(p*100)}٪`});
    if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=URL.createObjectURL(result.file);
    document.getElementById("result").src=resultUrl;
    const download=document.getElementById("download");download.href=resultUrl;download.download=result.file.name;download.hidden=false;
    status.textContent=JSON.stringify({originalBytes:file.size,resultBytes:result.file.size,seconds:Math.round((performance.now()-began)/1000),original:result.original,frames:result.frames,dimensions:result.dimensions,reason:result.reason});
  }catch(error){status.textContent=error.message;}finally{start.disabled=false;cancel.hidden=true;}
};
