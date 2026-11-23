// Only the new template workflow is covered. Active drafts and finished exports stay intact.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store.js";
import {pruneEditTraces} from './edit-trace.js';

export function pruneTemplateMedia(db, now=Date.now()) {
  try { pruneEditTraces(now); } catch (error) { console.warn('trace retention unavailable:',error.code || error.name); }
  const days=Number(process.env.RAW_RETENTION_DAYS||7);
  if(!Number.isFinite(days)||days<=0)return 0;
  let removed=0;
  const unlink=(dir,name)=>{if(path.basename(name)!==name)return;const target=path.join(DATA_DIR,"jobs",dir,name);if(fs.existsSync(target)){fs.rmSync(target);removed++;}};
  for(const job of db.jobs){
    if(!job.templateId||job.status!=="done"||!job.finishedAt||now-job.finishedAt<days*86400000||!/^[\w-]+$/.test(job.id))continue;
    if(job.isPreview&&db.edits?.some(e=>e.previewJobId===job.id&&!e.jobId&&!e.archived))continue;
    for(const a of job.templateData?.assets||[])if(/^[\w-]+\.media$/.test(a.file))unlink(job.id,a.file);
    if(job.templateData?.adVersion===2){for(const folder of ['ad-assets','ad-design']){const target=path.join(DATA_DIR,'jobs',job.id,folder);if(fs.existsSync(target)){fs.rmSync(target,{recursive:true,force:true});removed++;}}}
    const edit=db.edits?.find(e=>e.jobId===job.id);
    if(edit&&/^[\w-]+$/.test(edit.id)){
      for(const a of edit.assets){
        if(/^[\w-]+\.media$/.test(a.file))unlink(`edit-${edit.id}`,a.file);
        for(const ext of ["mp3","wav"])if(/^[\w-]+$/.test(a.id))unlink(`edit-${edit.id}`,`${a.id}.${ext}`);
      }
      edit.mediaExpired=true;
    }
  }
  return removed;
}
