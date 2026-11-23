(() => {
  function read(blob,ctl,timeout=20000){
    return new Promise((resolve,reject)=>{
      let reader,timer,finished=false;
      const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);if(ctl?.reader===reader)ctl.reader=null;if(ctl?.fail===abort)ctl.fail=null;error?reject(error):resolve(value);};
      const abort=()=>{finish(Object.assign(Error("آپلود لغو شد."),{cancelled:true}));if(reader?.readyState===1)reader.abort();};
      if(ctl){ctl.fail=abort;if(ctl.cancelled){abort();return;}}
      timer=setTimeout(()=>{finish(Object.assign(Error("خواندن ویدیو طول کشید؛ دوباره از گالری انتخابش کن."),{code:"UPLOAD_READ_TIMEOUT"}));if(reader?.readyState===1)reader.abort();},timeout);
      if(typeof FileReader!=="undefined"){
        reader=new FileReader();if(ctl)ctl.reader=reader;
        reader.onload=()=>finish(null,reader.result);
        reader.onerror=()=>finish(reader.error||Error("خواندن فایل ناموفق بود."));
        reader.onabort=()=>finish(Object.assign(Error("آپلود لغو شد."),{cancelled:true}));
        try{reader.readAsArrayBuffer(blob);}catch(error){finish(error);}
      }else blob.arrayBuffer().then(value=>finish(null,value),error=>finish(error));
    });
  }
  globalThis.UploadIO={read};
})();
