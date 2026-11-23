// Keep the selected original on the device until the server acknowledges it.
let database:Promise<IDBDatabase>|undefined;
function db(){return database??=new Promise((resolve,reject)=>{const r=indexedDB.open('creator-photo-draft:'+location.pathname.replace(/[^/]*$/,''),1);r.onupgradeneeded=()=>r.result.createObjectStore('photos');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function op(key:string,mode:IDBTransactionMode,action:(s:IDBObjectStore)=>IDBRequest){const d=await db();return new Promise<any>((resolve,reject)=>{const t=d.transaction('photos',mode),r=action(t.objectStore('photos'));t.oncomplete=()=>resolve(r.result);t.onerror=t.onabort=()=>reject(t.error);});}
export const photoDraft={load:(key:string)=>op(key,'readonly',s=>s.get(key)) as Promise<File|undefined>,save:(key:string,file:File)=>op(key,'readwrite',s=>s.put(file,key)),clear:(key:string)=>op(key,'readwrite',s=>s.delete(key))};
