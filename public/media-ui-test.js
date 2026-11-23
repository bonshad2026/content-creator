document.getElementById("begin").onclick=async()=>{
  const Audio=window.AudioContext||window.webkitAudioContext,ctx=new Audio(),osc=ctx.createOscillator(),gain=ctx.createGain(),dest=ctx.createMediaStreamDestination();
  osc.frequency.value=330;osc.connect(gain);gain.connect(dest);gain.gain.setValueAtTime(.03,ctx.currentTime);gain.gain.linearRampToValueAtTime(.3,ctx.currentTime+1);gain.gain.linearRampToValueAtTime(.05,ctx.currentTime+2);await ctx.resume();osc.start();
  const stop=MediaUI.live(dest.stream,document.getElementById("wave"),document.getElementById("time")),chunks=[],rec=new MediaRecorder(dest.stream);
  rec.ondataavailable=e=>chunks.push(e.data);rec.onstop=async()=>{osc.stop();stop();await ctx.close();const file=new File(chunks,"synthetic.webm",{type:rec.mimeType}),peaks=await MediaUI.peaks(file);const root=document.getElementById("player");root.innerHTML=MediaUI.audio(URL.createObjectURL(file),{peaks});MediaUI.bind(root);document.getElementById("result").textContent=`موج آماده شد؛ ${file.size} بایت؛ ${peaks?.length||0} نمونه`;} ;rec.start();setTimeout(()=>rec.stop(),2300);
};
