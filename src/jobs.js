// Background generation queue. Jobs run on the server, so the user can leave the screen (or close the app)
// and several posts can be in progress at once. At most MAX_PARALLEL AI requests run together.
import crypto from "node:crypto";
import { getDb, save, readFrameB64 } from "./store.js";
import { learnFromSamples, generatePost, styleText, revisePlan } from "./ai.js";
import { listMoods } from "./music.js";
import { runReel } from "./reel.js";
import { renderTemplate } from "./template-render.js";
import {createEditTrace,traceError} from './edit-trace.js';
import {isPhotoEdit,renderPhotoJob,accountAdUsage} from './photo-edit.js';
import {publicJobError} from './user-errors.js';

const db = getDb();
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL || 3);
const queue = [];
let active = 0;
const profileLocks = new Map(); // userId -> Promise (so parallel jobs share one style analysis)

const addUsage = (user, u) => {
  user.usage.tokens += u.tokens;
  user.usage.cost += u.cost;
};

/** Returns the short style text for a user, running the (single, cached) sample analysis if needed. */
async function ensureProfile(user, job) {
  const hash = crypto.createHash("sha1").update(JSON.stringify([user.style, user.samples.map((s) => s.id)])).digest("hex");
  if (user.profile?.hash === hash) return user.profile.text;

  if (!profileLocks.has(user.id)) {
    profileLocks.set(
      user.id,
      (async () => {
        let learned = null;
        if (user.samples.length) {
          const samples = user.samples.slice(-6).map((s) => s.frames.slice(0, 2).map(readFrameB64));
          const r = await learnFromSamples(user.style, samples);
          learned = r.data;
          addUsage(user, r.usage);
          job.usage.tokens += r.usage.tokens;
          job.usage.cost += r.usage.cost;
          job.usage.note = "شامل تحلیل یک‌باره‌ی نمونه‌کارها";
        }
        user.profile = { hash, learned, text: styleText(user.style, learned), updatedAt: Date.now() };
        save();
      })().finally(() => profileLocks.delete(user.id))
    );
  }
  await profileLocks.get(user.id);
  return user.profile.text;
}

async function run(job) {
  const user = db.users[job.userId];
  if (!user) return;
  const trace=job.templateId?createEditTrace({editId:job.editId,kind:'render',jobId:job.id,analysisTraceId:job.analysisTraceId||null,revisionOf:job.revisionOf||null}, {resumeId:job.renderTraceId||null}):null;
  if(trace)job.renderTraceId=trace.id;
  job.status = "running";
  job.startedAt = Date.now();
  save();
  try {
    if (job.templateId) {
      trace.record('render.input',{jobId:job.id,templateId:job.templateId,templateData:job.templateData});
      const progress=stage=>{trace.record('render.progress',{stage});job.stage=stage;save();};
      Object.assign(job, isPhotoEdit(job)?await renderPhotoJob(job,progress,{onUsage:event=>{accountAdUsage(job,user,event);trace.record('image.usage',event);save();}}):await renderTemplate(job,progress,trace));
      job.status = "done"; job.stage = null; job.finishedAt = Date.now(); save();
      trace.record('render.completed',{jobId:job.id,status:job.status,video:job.video,output:job.output});
      return;
    }
    // taste memory: the creator's last few notes on earlier edits ride along (a few dozen tokens)
    const taste = user.taste?.length ? `\nCreator's feedback on past edits (follow it): ${user.taste.slice(-6).join(" | ")}` : "";
    const profileText = (await ensureProfile(user, job)) + taste;
    if (job.kind === "reel") {
      let manual = null;
      if (job.revise) {
        // revise = the previous plan + the creator's note → updated plan (text only: no frames, no speech-to-text again)
        const parent = db.jobs.find((j) => j.id === job.revise.parentId);
        if (!parent?.plan) throw new Error("پلن ویدیوی قبلی پیدا نشد. یک ریلز تازه بساز.");
        job.stage = "writing";
        save();
        const info = job.inputs.map((i) => `${i.n}: ${i.type}`).join(", ");
        const rv = await revisePlan(profileText, parent.plan, parent.transcript || [], job.revise.note, info, listMoods());
        job.usage.tokens += rv.usage.tokens;
        job.usage.cost += rv.usage.cost;
        addUsage(user, rv.usage);
        manual = { plan: rv.data, transcript: parent.transcript || [], spokenLang: parent.spokenLang };
      }
      const r = await runReel(job, profileText, (stage) => ((job.stage = stage), save()), manual);
      Object.assign(job, { output: r.output, video: r.video, coverImg: r.coverImg, stage: null, plan: r.plan, transcript: r.transcript, spokenLang: r.spokenLang });
      job.usage.tokens += r.usage.tokens;
      job.usage.cost += r.usage.cost;
      addUsage(user, r.usage);
    } else {
      const r = await generatePost(profileText, { kind: job.kind, frames: job.frames.map(readFrameB64) }, job.brief);
      job.output = r.data;
      job.usage.tokens += r.usage.tokens;
      job.usage.cost += r.usage.cost;
      addUsage(user, r.usage);
    }
    job.status = "done";
  } catch (e) {
    if(isPhotoEdit(job)&&e.needsInput){job.status='awaiting_input';job.photoQuestion=e.question;job.stage=null;job.finishedAt=Date.now();save();return;}
    trace?.record('render.error',{error:traceError(e)});
    console.error("job", job.id, e.message);
    job.status = "error";
    job.errorCode=e.code||null;
    job.error =
      e.publicMessage ? e.publicMessage : e.status === 429 ? "سرویس هوش مصنوعی شلوغ است. کمی بعد دوباره تلاش کنید."
      : /quota|balance|credit|insufficient/i.test(e.message || "") ? "اعتبار حساب هوش مصنوعی تمام شده. حساب را شارژ کنید و دوباره تلاش کنید."
      : e.status === 401 ? "کلید API نامعتبر است."
      : e.message?.startsWith("پاسخ مدل") || e.message?.startsWith("فایل ویدیو") ? e.message
      : e.message?.startsWith("ffmpeg") ? "ساخت ویدیو ناموفق بود. دوباره تلاش کنید."
      : "تولید ناموفق بود. دوباره تلاش کنید.";
    job.error=publicJobError(job);
  }
  job.finishedAt = Date.now();
  save();
}

function pump() {
  while (active < MAX_PARALLEL && queue.length) {
    const job = queue.shift();
    active++;
    run(job).finally(() => {
      active--;
      pump();
    });
  }
}

export function enqueue(job) {
  queue.push(job);
  pump();
}

// On restart, resume anything that didn't finish (its frames are on disk).
for (const j of db.jobs) {
  if(process.env.APP_EDITION!=='studio-internal')continue;
  if (j.status === "uploading") Object.assign(j, { status: "error", error: "آپلود کامل نشد. دوباره بفرست." });
  if (j.status === "queued" || j.status === "running") {
    j.status = "queued";
    enqueue(j);
  }
}
