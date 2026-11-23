const owner="__draft_test__";
async function read(){const d=await ChatDraft.load(owner,"test-edit");document.getElementById("status").textContent=d?JSON.stringify({text:d.text,part:d.part,files:d.pending.map(p=>({name:p.file.name,size:p.file.size,saved:p.saved})),missing:d.missing}):"هنوز ذخیره نشده";}
document.getElementById("write").onclick=async()=>{const p={id:"fixture",type:"video",file:new File([new Uint8Array(65536).fill(7)],"draft-fixture.mp4",{type:"video/mp4"})};await ChatDraft.putFile(owner,p);await ChatDraft.save(owner,{editId:"test-edit",text:"متن باقی می‌ماند",part:"opening",pending:[{id:p.id,type:p.type}]});await read();};
read().catch(e=>document.getElementById("status").textContent=e.message);
