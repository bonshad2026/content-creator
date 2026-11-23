(() => {
  const esc=s=>String(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const clock=t=>`${Math.floor((Number(t)||0)/60)}:${String(Math.floor((Number(t)||0)%60)).padStart(2,"0")}`;
  const play='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" fill="currentColor"/></svg>';
  const pause='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor"/></svg>';
  function bars(peaks){return Array.from({length:48},(_,i)=>`<i style="height:${peaks?.length?Math.max(4,Math.round((peaks[Math.floor(i*peaks.length/48)]||0)*30)):6}px"></i>`).join("");}
  function audio(src,{peaks,label="پیام صوتی"}={}){return `<div class="voice-player"><button type="button" class="voice-toggle" aria-label="پخش ${esc(label)}">${play}</button><div class="voice-wave" role="slider" tabindex="0" aria-label="زمان صدا" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">${bars(peaks)}</div><small class="voice-time">0:00</small><audio preload="metadata" src="${esc(src)}"></audio><span class="media-error" hidden>صدا باز نشد</span></div>`;}
  function video(src){return `<div class="custom-video"><video playsinline preload="metadata" src="${esc(src)}"></video><button class="video-toggle" type="button" aria-label="پخش ویدیو">${play}</button><div class="video-toolbar"><span class="video-time">0:00</span><input class="video-seek" type="range" min="0" max="100" step=".1" value="0" aria-label="زمان ویدیو"><button class="video-fullscreen" type="button" aria-label="تمام‌صفحه">⛶</button></div><small class="media-error" hidden>ویدیو باز نشد</small></div>`;}
  function bind(root=document){
    root.querySelectorAll(".voice-player:not([data-bound])").forEach(widget=>{
      widget.dataset.bound="1";const media=widget.querySelector("audio"),button=widget.querySelector("button"),wave=widget.querySelector(".voice-wave"),time=widget.querySelector(".voice-time");
      const update=()=>{const p=Number.isFinite(media.duration)&&media.duration>0?media.currentTime/media.duration:0;wave.setAttribute("aria-valuenow",Math.round(p*100));wave.querySelectorAll("i").forEach((bar,i)=>bar.classList.toggle("played",i/48<p));time.textContent=clock(media.currentTime||media.duration);};
      button.onclick=async()=>{if(media.paused){document.querySelectorAll("audio,video").forEach(m=>{if(m!==media)m.pause();});try{await media.play();}catch{widget.querySelector(".media-error").hidden=false;}}else media.pause();};
      media.onplay=()=>{button.innerHTML=pause;button.setAttribute("aria-label","توقف صدا");};media.onpause=media.onended=()=>{button.innerHTML=play;button.setAttribute("aria-label","پخش صدا");};
      media.ontimeupdate=media.onloadedmetadata=update;media.onerror=()=>widget.querySelector(".media-error").hidden=false;
      const seek=p=>{if(Number.isFinite(media.duration))media.currentTime=Math.max(0,Math.min(media.duration,p*media.duration));update();};
      wave.onclick=event=>{const b=wave.getBoundingClientRect();seek((event.clientX-b.left)/b.width);};wave.onkeydown=event=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){event.preventDefault();seek(event.key==="Home"?0:event.key==="End"?1:(media.currentTime+(event.key==="ArrowRight"?5:-5))/media.duration);}};
    });
    root.querySelectorAll(".custom-video:not([data-bound])").forEach(widget=>{
      widget.dataset.bound="1";const media=widget.querySelector("video"),button=widget.querySelector(".video-toggle"),seek=widget.querySelector("input");
      button.onclick=async()=>{if(media.paused){document.querySelectorAll("audio,video").forEach(m=>{if(m!==media)m.pause();});try{await media.play();}catch{widget.querySelector(".media-error").hidden=false;}}else media.pause();};
      media.onclick=button.onclick;media.onplay=()=>{button.innerHTML=pause;button.setAttribute("aria-label","توقف ویدیو");widget.classList.add("playing");};media.onpause=media.onended=()=>{button.innerHTML=play;button.setAttribute("aria-label","پخش ویدیو");widget.classList.remove("playing");};
      media.ontimeupdate=media.onloadedmetadata=()=>{seek.value=Number.isFinite(media.duration)?media.currentTime/media.duration*100:0;widget.querySelector(".video-time").textContent=clock(media.currentTime||media.duration);};
      seek.oninput=()=>{if(Number.isFinite(media.duration))media.currentTime=Number(seek.value)/100*media.duration;};media.onerror=()=>widget.querySelector(".media-error").hidden=false;
      widget.querySelector(".video-fullscreen").onclick=()=>{if(widget.requestFullscreen)widget.requestFullscreen().catch(()=>{});else media.webkitEnterFullscreen?.();};
    });
  }
  async function peaks(file){if(file.size>16*1048576)return null;const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return null;const ctx=new Audio();try{const buffer=await ctx.decodeAudioData(await file.arrayBuffer()),data=buffer.getChannelData(0),out=[];for(let i=0;i<48;i++){let peak=0;for(let j=Math.floor(i*data.length/48);j<Math.floor((i+1)*data.length/48);j+=8)peak=Math.max(peak,Math.abs(data[j]));out.push(peak);}const max=Math.max(.01,...out);return out.map(x=>x/max);}catch{return null;}finally{await ctx.close().catch(()=>{});}}
  function live(stream,canvas,time){
    const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return ()=>{};
    const ctx=new Audio(),analyser=ctx.createAnalyser();analyser.fftSize=256;ctx.createMediaStreamSource(stream).connect(analyser);ctx.resume().catch(()=>{});
    const data=new Uint8Array(analyser.frequencyBinCount),history=new Array(48).fill(.05),draw=canvas.getContext("2d"),start=performance.now();let timer;
    timer=setInterval(()=>{analyser.getByteTimeDomainData(data);let sum=0;for(const v of data)sum+=((v-128)/128)**2;const level=Math.min(1,Math.sqrt(sum/data.length)*5);history.shift();history.push(Math.max(.05,level));canvas.width=Math.max(240,canvas.clientWidth*2);canvas.height=88;draw.clearRect(0,0,canvas.width,88);draw.fillStyle=getComputedStyle(canvas).color;const step=canvas.width/48;history.forEach((v,i)=>{const h=Math.max(4,v*78);draw.fillRect(i*step,44-h/2,Math.max(3,step*.45),h);});time.textContent=clock((performance.now()-start)/1000);},80);
    return ()=>{clearInterval(timer);ctx.close().catch(()=>{});};
  }
  window.MediaUI={audio,video,bind,peaks,live};
})();
