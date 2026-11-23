// A single local draft per account. Large files are written separately from text.
(() => {
  const dbp = new Promise((resolve,reject)=>{
    const request=indexedDB.open("creator-chat-draft:"+location.pathname.replace(/[^/]*$/,""),1);
    request.onupgradeneeded=()=>{request.result.createObjectStore("meta");request.result.createObjectStore("files");};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  dbp.catch(()=>{}); // Each operation still reports the real failure to the UI.
  async function tx(store,mode,fn){const db=await dbp;return new Promise((resolve,reject)=>{const t=db.transaction(store,mode),r=fn(t.objectStore(store));t.oncomplete=()=>resolve(r?.result);t.onabort=t.onerror=()=>reject(t.error||Error("ذخیرهٔ پیش‌نویس ناموفق بود."));});}
  const key=(owner,id)=>`${owner}:${id}`;
  async function clear(owner){const meta=await tx("meta","readonly",s=>s.get(owner));if(meta){for(const p of meta.pending||[]){await tx("files","readwrite",s=>s.delete(key(owner,p.id)));await tx("files","readwrite",s=>s.delete(key(owner,p.id)+":prepared"));}}await tx("meta","readwrite",s=>s.delete(owner));}
  async function load(owner,editId){const meta=await tx("meta","readonly",s=>s.get(owner));if(!meta||meta.editId!==editId)return null;
    const pending=[];let missing=false;
    for(const p of meta.pending||[]){const original=await tx("files","readonly",s=>s.get(key(owner,p.id)));if(!original){missing=true;continue;}
      const prepared=p.prepared?await tx("files","readonly",s=>s.get(key(owner,p.id)+":prepared")):null;
      pending.push({...p,originalFile:prepared?original:null,file:prepared||original,saved:true});}
    return {...meta,pending,missing};}
  async function putFile(owner,item){await tx("files","readwrite",s=>s.put(item.originalFile||item.file,key(owner,item.id)));if(item.originalFile)await tx("files","readwrite",s=>s.put(item.file,key(owner,item.id)+":prepared"));}
  const save=(owner,meta)=>tx("meta","readwrite",s=>s.put({...meta,updatedAt:Date.now()},owner));
  window.ChatDraft={load,save,putFile,clear,drop:async(owner,id)=>{await tx("files","readwrite",s=>s.delete(key(owner,id)));await tx("files","readwrite",s=>s.delete(key(owner,id)+":prepared"));}};
})();
