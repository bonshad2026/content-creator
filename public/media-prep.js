// Optional, local-only browser preparation. Originals are never overwritten.
(() => {
  const cancelled = () => new DOMException("آماده‌سازی لغو شد.", "AbortError");
  function available() {
    return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream &&
      HTMLVideoElement.prototype.requestVideoFrameCallback && (window.AudioContext || window.webkitAudioContext));
  }
  function encoding() {
    return ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp8,opus"]
      .find(type => MediaRecorder.isTypeSupported(type));
  }
  function dimensions(width, height) {
    const scale = Math.min(1, 1920 / Math.max(width,height), 1080 / Math.min(width,height));
    return { width: Math.max(2, Math.floor(width*scale/2)*2), height: Math.max(2, Math.floor(height*scale/2)*2) };
  }
  function once(target, name, signal, timeout = 20000) {
    return new Promise((resolve,reject) => {
      const clean = () => { clearTimeout(timer); target.removeEventListener(name,done); target.removeEventListener("error",error); signal?.removeEventListener("abort",abort); };
      const done = () => {clean();resolve();};
      const error = () => {clean();reject(Error("مرورگر این فایل رو نمی‌خونه؛ اصل فایل رو بفرست."));};
      const abort = () => {clean();reject(cancelled());};
      const timer = setTimeout(error,timeout);
      target.addEventListener(name,done,{once:true});target.addEventListener("error",error,{once:true});signal?.addEventListener("abort",abort,{once:true});
      if(signal?.aborted)abort();
    });
  }
  async function metadata(file, signal) {
    const video=document.createElement("video"), url=URL.createObjectURL(file);
    video.preload="metadata";video.muted=true;video.playsInline=true;
    try {const loaded=once(video,"loadedmetadata",signal);video.src=url;await loaded;
      if(!Number.isFinite(video.duration)||video.duration<=0)throw Error("مدت فایل مشخص نیست؛ اصل فایل رو بفرست.");
      return {width:video.videoWidth,height:video.videoHeight,duration:video.duration};
    } finally {video.removeAttribute("src");video.load();URL.revokeObjectURL(url);}
  }
  async function compress(file, {signal,onProgress=()=>{}}={}) {
    if(!available()||!encoding())throw Error("این مرورگر فشرده‌سازی رو پشتیبانی نمی‌کنه؛ اصل فایل رو بفرست.");
    if(document.hidden)throw Error("برای آماده‌سازی، صفحه رو باز نگه دار.");
    const info=await metadata(file,signal), size=dimensions(info.width,info.height);
    if(info.duration>180)throw Error("این فایل طولانیه؛ اصل فایل رو مستقیم بفرست.");
    const bitrate=Math.round(Math.max(1500000,Math.min(8000000,size.width*size.height*30*.105)));
    if(file.size*8/info.duration < bitrate*1.15 && size.width===info.width && size.height===info.height)
      return {file,original:true,reason:"حجم فایل مناسبه؛ تبدیل لازم نیست.",info};
    const type=encoding(), video=document.createElement("video"),canvas=document.createElement("canvas");
    canvas.width=size.width;canvas.height=size.height;
    const ctx=canvas.getContext("2d",{alpha:false}),url=URL.createObjectURL(file);
    video.playsInline=true;video.preload="auto";
    // A rendered but tiny element keeps mobile video-frame callbacks alive.
    video.style.cssText="position:fixed;width:2px;height:2px;bottom:0;left:0;pointer-events:none;opacity:.01";
    document.body.append(video);
    const Audio=window.AudioContext||window.webkitAudioContext;
    const audio=new Audio(), destination=audio.createMediaStreamDestination();
    const stream=canvas.captureStream(30),chunks=[];
    let recorder,frameId,watchdog,stopError,ended=false,frameCount=0;
    const stop = error => {stopError ||= error; video.pause();if(recorder?.state!=="inactive")recorder?.stop();};
    const abort=()=>stop(cancelled());
    const visibility=()=>{if(document.hidden)stop(Error("صفحه بسته شد؛ تبدیل متوقف شد. اصل فایل محفوظ است."));};
    try {
      signal?.addEventListener("abort",abort,{once:true});document.addEventListener("visibilitychange",visibility);
      const loaded=once(video,"loadeddata",signal);video.src=url;await loaded;
      const source=audio.createMediaElementSource(video);source.connect(destination);
      // Route audio into the recording only, never play a second copy through speakers.
      destination.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
      await audio.resume();
      if(audio.state!=="running")throw Error("صدا آماده نشد؛ اصل فایل رو بفرست.");
      ctx.drawImage(video,0,0,size.width,size.height);
      recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:bitrate,audioBitsPerSecond:128000});
      const completed=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=()=>{stopError=Error("تبدیل ناموفق بود؛ اصل فایل محفوظ است.");stop(stopError);};});
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      const draw=()=>{if(video.ended||recorder.state==="inactive")return;ctx.drawImage(video,0,0,size.width,size.height);frameCount++;onProgress(Math.min(.99,video.currentTime/info.duration));frameId=video.requestVideoFrameCallback(draw);};
      video.onended=()=>{ended=true;stop();};video.onerror=()=>stop(Error("خواندن ویدیو متوقف شد؛ اصل فایل رو بفرست."));
      recorder.start(1000);frameId=video.requestVideoFrameCallback(draw);
      watchdog=setTimeout(()=>stop(Error("تبدیل طول کشید؛ اصل فایل رو بفرست.")),(info.duration*1.5+15)*1000);
      if(signal?.aborted)throw cancelled();
      await video.play();await completed;
      if(stopError)throw stopError;
      if(!ended||frameCount<Math.max(2,info.duration*15))throw Error("فریم کافی ثبت نشد؛ اصل فایل رو بفرست.");
      const blob=new Blob(chunks,{type:recorder.mimeType||type});
      if(!blob.size)throw Error("خروجی خالی شد؛ اصل فایل محفوظ است.");
      // MediaRecorder WebM may lack duration headers. Don't pretend that browser metadata
      // proves sync: keep preview approval explicit and validate again on the server.
      if(blob.size>=file.size*.95)return {file,original:true,reason:"کاهش حجم کافی نبود؛ اصل فایل بهتره.",info};
      onProgress(1);
      return {file:new File([blob],file.name.replace(/\.[^.]+$/,"")+"-prepared."+(type.includes("mp4")?"mp4":"webm"),{type:blob.type,lastModified:file.lastModified||Date.now()}),original:false,info,frames:frameCount,dimensions:size};
    } finally {
      clearTimeout(watchdog);signal?.removeEventListener("abort",abort);document.removeEventListener("visibilitychange",visibility);
      if(frameId)video.cancelVideoFrameCallback(frameId);
      if(recorder&&recorder.state!=="inactive")recorder.stop();
      stream.getTracks().forEach(t=>t.stop());destination.stream.getTracks().forEach(t=>t.stop());
      video.pause();video.removeAttribute("src");video.load();video.remove();URL.revokeObjectURL(url);await audio.close().catch(()=>{});
    }
  }
  window.MediaPrep={available,metadata,dimensions,compress};
})();
