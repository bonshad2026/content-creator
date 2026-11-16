// All AI calls. GapGPT (OpenAI-compatible). Without GAPGPT_API_KEY → demo mode with canned output.
//
// Token-saving design:
//  • Videos are never uploaded: the phone extracts 4 small frames (≤480px) in the browser.
//  • The style is turned into a short text profile ONCE; if there are no samples, no AI call at all.
//    The profile is cached and only rebuilt when the style or samples change.
//  • Each post = one request: small images + the short profile. No sample images are re-sent.
//  • reasoning_effort "low" (no long hidden thinking) and a hard max_tokens cap.
//  • Every request's token count and cost are recorded and shown to the user.
import OpenAI from "openai";
import { mockProfile, mockGeneration } from "./mock.js";
import { LOOKS, LEAK_STYLES, listStickers } from "./media.js";
import { RECIPES, RECIPE_NAMES } from "./recipes.js";

export const MODEL = process.env.AI_MODEL || "claude-opus-5-5";
export const demoMode = !process.env.GAPGPT_API_KEY;
const client = demoMode
  ? null
  : new OpenAI({ apiKey: process.env.GAPGPT_API_KEY, baseURL: process.env.GAPGPT_BASE_URL || "https://api.gapgpt.app/v1" });

// reply ceiling for a full edit plan (only a cap: the reply is paid by its real length)
const PLAN_LIMIT = 6000;

const img = (b64) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });

function parseJson(text) {
  const s = text.replace(/```(?:json)?/gi, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < 0) return null;
  const raw = s.slice(a, b + 1);
  try {
    return JSON.parse(raw);
  } catch {
    // common slip: real line breaks / tabs inside string values → escape them and try again
    try {
      return JSON.parse(raw.replace(/"(?:[^"\\]|\\.)*"/gs, (m) => m.replace(/\n/g, "\\n").replace(/\r/g, "").replace(/\t/g, "\\t")));
    } catch {
      return null;
    }
  }
}

/**
 * A reply cut off mid-JSON (finish=length): close it at the last complete value instead of paying for the request
 * again. Drops the unfinished tail (an open string, a half-written object) and closes the open brackets.
 */
export function repairJson(text) {
  const s = text.replace(/```(?:json)?/gi, "");
  const a = s.indexOf("{");
  if (a < 0) return null;
  const stack = [];
  let inStr = false, esc = false, lastSafe = -1, safeStack = null;
  for (let i = a; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
    // a safe cut point: right after a finished value: between array items or top-level keys (a comma inside a nested
    // object would keep a half-written clip / text)
    const commaOk = ch === "," && (stack.length === 1 || stack[stack.length - 1] === "]");
    if (commaOk || ch === "}" || ch === "]") {
      lastSafe = ch === "," ? i : i + 1;
      safeStack = stack.slice();
      if (!stack.length) return parseJson(s.slice(a, i + 1));
    }
  }
  if (lastSafe < 0) return null;
  try {
    return JSON.parse(s.slice(a, lastSafe).replace(/,\s*$/, "") + safeStack.reverse().join(""));
  } catch {
    return null;
  }
}

// Every real request is logged here (one JSON line each): what the tokens went to, and whether caching works.
const USAGE_LOG = process.env.USAGE_LOG || `${process.env.DATA_DIR || "data"}/usage-log.jsonl`; // inside DATA_DIR (the docker volume)

/**
 * One request. max_tokens is only a ceiling (you pay for what is written), so it is set high enough that a normal
 * reply is never cut off. If it still is: the JSON is repaired locally (no second payment); only if that fails is
 * the request sent once more with a 1.5x limit. An unparseable complete reply is retried once as before.
 * AI_DRYRUN=<file>: nothing is sent; the request is written to that file and a DRYRUN error is thrown (token budget).
 */
async function call(system, content, maxTokens, label = "") {
  if (process.env.AI_DRYRUN) {
    const fs = await import("node:fs");
    fs.writeFileSync(process.env.AI_DRYRUN, JSON.stringify({ label, maxTokens, system, content }));
    throw Object.assign(new Error("DRYRUN"), { dryRun: true });
  }
  const usage = { tokens: 0, cost: 0, requests: [] };
  let limit = maxTokens;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await client.chat.completions.create({
      model: process.env.AI_MODEL || MODEL, // read per request: the model comparison switches it between runs
      max_tokens: limit,
      reasoning_effort: "low",
      messages: [{ role: "system", content: system }, { role: "user", content }],
    });
    const u = res.usage || {};
    const finish = res.choices?.[0]?.finish_reason;
    const rec = {
      at: new Date().toISOString(), label, model: process.env.AI_MODEL || MODEL, attempt, finish, limit,
      prompt: u.prompt_tokens ?? null, reply: u.completion_tokens ?? null, total: u.total_tokens ?? null,
      cached: u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? null,
      reasoning: u.completion_tokens_details?.reasoning_tokens ?? null, cost: u.cost ?? null,
    };
    usage.tokens += u.total_tokens || 0;
    usage.cost += u.cost || 0;
    usage.requests.push(rec);
    try {
      const fs = await import("node:fs");
      fs.appendFileSync(USAGE_LOG, JSON.stringify(rec) + "\n");
    } catch {}
    const text = res.choices?.[0]?.message?.content || "";
    const data = parseJson(text) || (finish === "length" ? repairJson(text) : null);
    if (data) {
      if (finish === "length") console.warn(`reply cut off at ${limit} tokens, repaired locally (${label})`);
      return { data, usage };
    }
    console.warn(`unparseable reply (attempt ${attempt}, finish=${finish}):`, text.slice(0, 300));
    if (finish === "length") limit = Math.round(limit * 1.5);
  }
  throw new Error("پاسخ مدل قابل خواندن نبود. دوباره تلاش کنید.");
}

// ---------- style → short text ----------
const LENGTH = { "کوتاه": "under 40 words", "متوسط": "40-100 words", "بلند": "100-200 words, storytelling" };
const EMOJI = { "بدون ایموجی": "no emoji", "کم": "1-3 emoji", "زیاد": "many emoji (5+)" };
const TAGS = { "بدون هشتگ": "no hashtags", "چندتا (۳ تا ۵)": "3-5 hashtags", "زیاد (۱۰+)": "10-15 hashtags" };

export function styleText(style, learned) {
  const lines = [
    `Platform: ${style.platform}`,
    `Niche: ${style.niche}`,
    `Tone: ${(style.tone || []).join(", ")}`,
    `Language: ${style.language}`,
    `Audience: ${(style.audience || []).join(", ")}`,
    `Caption length: ${LENGTH[style.length] || style.length}`,
    `Emoji: ${EMOJI[style.emoji] || style.emoji}`,
    `Hashtags: ${TAGS[style.hashtags] || style.hashtags}`,
    `Ending / call to action: ${style.cta}`,
  ];
  if (style.description) lines.push(`Creator's own notes: ${style.description}`);
  if (learned) lines.push(`Learned from their past posts: ${learned.voice} Visual: ${learned.visual}`, `Do: ${learned.dos?.join("; ")}`, `Avoid: ${learned.donts?.join("; ")}`);
  return lines.join("\n");
}

/** One call over the sample media (≤6 samples × ≤2 small frames). Returns a compact profile. */
export async function learnFromSamples(style, samplesB64) {
  if (demoMode) return mockProfile();
  const content = [{ type: "text", text: `Creator settings:\n${styleText(style)}\n\nTheir past posts (images / video frames):` }];
  samplesB64.forEach((frames, i) => {
    content.push({ type: "text", text: `Post ${i + 1}:` });
    frames.forEach((f) => content.push(img(f)));
  });
  return call(
    "You analyse a social-media creator's past posts so their style can be copied. Be concise. " +
      'Reply ONLY with JSON: {"voice":"1-2 sentences on how they likely talk/present","visual":"1-2 sentences: framing, colours, on-screen text, pace","dos":["max 4"],"donts":["max 3"]}. ' +
      "Write the values in the creator's content language.",
    content,
    700,
    "profile"
  );
}

/**
 * Speech → timed text (Whisper). Every line keeps Whisper's own confidence stats (noSpeech, logprob, compression);
 * src/audio.js decides which lines are trusted and whether the input is speech at all.
 * No `prompt` is sent: the Persian hint words biased language detection on English / non-speech audio, and the
 * planner corrects mis-heard words in its `subs` anyway. `language` (ISO code) only when it is known.
 */
export async function transcribe(audioFile, language = "") {
  if (demoMode) return { segments: [], language: "", duration: 0, cost: 0 };
  const fs = await import("node:fs");
  const r = await client.audio.transcriptions.create({
    model: "whisper-1", file: fs.createReadStream(audioFile), response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"], // word times → karaoke subtitles (same price)
    ...(language ? { language } : {}),
  });
  // hand the words out to their segments in order (times at segment edges are often shared, so count instead)
  const words = (r.words || []).map((w) => ({ start: w.start, end: w.end, text: String(w.word).trim() }));
  let wi = 0;
  const segments = (r.segments || [])
    .map((s) => {
      const count = s.text.trim().split(/\s+/).filter(Boolean).length;
      const own = words.slice(wi, wi + count);
      wi += count;
      return { start: s.start, end: s.end, text: s.text.trim(), words: own, noSpeech: s.no_speech_prob ?? 0, logprob: s.avg_logprob ?? null, compression: s.compression_ratio ?? null };
    })
    .filter((s) => s.text);
  // Whisper auto-detects the spoken language (Persian, English, …)
  return { segments, language: r.language || "", duration: r.duration || 0, cost: ((r.duration || 0) / 60) * 0.006 };
}

/**
 * One call that both writes the post and plans the video edit.
 * inputs: [{n, type, duration, hasSpeech, frames:[{t, b64}]}], transcript: [{n, start, end, text}]
 */
export async function planReel(profileText, inputs, transcript, brief, spokenLang = "", moods = [], target = null, moments = null) {
  if (moments) return planByMoments(profileText, inputs, transcript, brief, spokenLang, moods, target, moments);
  if (demoMode && !process.env.AI_DRYRUN) return mockReelPlan(inputs);
  const content = [{ type: "text", text: `Goal / topic of this post: ${brief || "(none, pick the best angle from the media)"}` }];
  if (target) content.push({ type: "text", text: `TARGET LENGTH: the creator asked for about ${target} s. Make the clips add up to ${Math.round(target * 0.9)}-${Math.round(target * 1.05)} s (a clip with speed lasts (e-s)/speed).` });
  for (const inp of inputs) {
    if (inp.sheet) {
      content.push({ type: "text", text: `Input ${inp.n}: video, ${inp.duration.toFixed(1)}s${audioNote(inp)}${inp.scenes?.length ? `, shot changes at ${inp.scenes.slice(0, 100).map((t) => t.toFixed(1)).join(", ")}s` : ""}. ` +
        `Contact sheet: ${inp.sheet.count} frames spread over the whole video, in reading order (left to right, top to bottom), each labelled with its time in seconds. Use moments from ALL of it, not only one part:` });
      content.push(img(inp.sheet.b64));
      continue;
    }
    content.push({ type: "text", text: inp.type === "image" ? `Input ${inp.n}: photo (slow zoom-in; you choose 1.5-8s on screen via its clip s=0,e=seconds)` : `Input ${inp.n}: video, ${inp.duration.toFixed(1)}s${audioNote(inp)}${inp.scenes?.length ? `, shot changes at ${inp.scenes.slice(0, 15).map((t) => t.toFixed(1)).join(", ")}s` : ", one continuous shot"}. Frames:` });
    for (const f of inp.frames) {
      if (inp.type !== "image") content.push({ type: "text", text: `@${f.t.toFixed(1)}s` });
      content.push(img(f.b64));
    }
  }
  if (transcript.length)
    content.push({
      type: "text",
      text: `Narration / speech (spoken language: ${spokenLang || "unknown"}). Lines: #index input [start-end] text\n` +
        transcript.map((s, i) => `#${i} ${s.n} [${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join("\n"),
    });

  // static rules first, the creator's style last: the long identical prefix can be cached by the provider (cheaper repeats)
  // the reply ceiling costs nothing unless used: with 1800 a long plan got cut off and was paid for twice (Arcane run 1)
  return call(`${reelRules(moods)}\n\nCREATOR STYLE:\n${profileText}`, content, PLAN_LIMIT, "plan");
}

// what the model is told about an input's sound (the code acts on the class; the model only needs to know)
const audioNote = (inp) => (inp.audioClass === "speech" || (!inp.audioClass && inp.hasSpeech) ? ", has speech" : inp.audioClass === "music_or_mixed" ? ", has its own soundtrack (muted under the background music you pick; with music \"none\" it plays as is)" : "");

/** The editor's rulebook (identical for every reel → cacheable). The detailed craft lives in code (recipes.js, reel.js). */
/**
 * P1-5 "moments" mode (AI_PLAN_MODE=moments): the model CHOOSES, it does not compose. It sees numbered moments
 * (found and scored locally, one labelled contact sheet per video) and answers with moment numbers, a recipe and
 * a few short texts. Timing, transitions, animation, sound, positions and length are all done in code.
 * moments: [{id, n, s, e, kind, sheet?}] — inputs carry `momentSheet` (b64) for videos, `frames` for photos.
 */
async function planByMoments(profileText, inputs, transcript, brief, spokenLang, moods, target, moments) {
  if (demoMode && !process.env.AI_DRYRUN) return mockMomentPlan(moments);
  const content = [{ type: "text", text: `Goal / topic of this post: ${brief || "(none, pick the best angle from the media)"}` }];
  if (target) content.push({ type: "text", text: `Length: about ${target} s (the app fits it exactly; pick roughly enough moments).` });
  // a speech moment points at its lines (#a-#b in the speech list below) instead of repeating the words
  const lineIds = (m) => transcript.map((l, i) => (l.n === m.n && l.start < m.e && l.end > m.s ? i : -1)).filter((i) => i >= 0);
  const says = (m) => { const ids = lineIds(m); return ids.length ? ` speech #${ids[0]}${ids.length > 1 ? `-#${ids[ids.length - 1]}` : ""}` : ""; };
  for (const inp of inputs) {
    const own = moments.filter((m) => m.n === inp.n);
    if (!own.length) continue;
    const list = own.map((m) => `M${m.id} ${(m.e - m.s).toFixed(1)}s${m.kind === "speech" ? says(m) : ""}`).join(" · ");
    if (inp.type === "image") {
      content.push({ type: "text", text: `Input ${inp.n}: photo = M${own[0].id}` });
      content.push(img(inp.frames[0].b64));
      continue;
    }
    content.push({ type: "text", text: `Input ${inp.n}: video, ${inp.duration.toFixed(0)}s${audioNote(inp)}. Its moments in time order (each cell of the sheet is labelled): ${list}` });
    if (inp.momentSheet) content.push(img(inp.momentSheet));
  }
  if (transcript.length)
    content.push({ type: "text", text: `Speech lines (language: ${spokenLang || "unknown"}), #index text:\n` + transcript.map((s, i) => `#${i} ${s.text}`).join("\n") });
  return call(`${momentRules(moods)}\n\nCREATOR STYLE:\n${profileText}`, content, PLAN_LIMIT, "plan-moments");
}

/** The short rulebook of moments mode: decisions only, no numbers to invent except moment / line numbers. */
function momentRules(moods) {
  return (
    "You are ONE creator's video editor and copywriter. From numbered moments of their footage, choose what goes into a vertical short (Reels/Shorts), and write the post in their exact voice.\n\n" +
    `1. recipe: one of [${RECIPE_NAMES.map((r) => `${r} (${RECIPES[r].about})`).join("; ")}].\n` +
    "2. moments: the moment numbers to use, in the order they should play. Open with the most striking one and end on a strong one (never an empty or dull frame). Keep the story clear; skip dull or repeated moments. With speech, keep the moments whose words matter, in order.\n" +
    "3. texts: 1-4 short on-screen lines (max 5 words, no emoji), each on a picked moment: {\"m\":3,\"text\":\"...\",\"pos\":\"top\"|\"center\"}. The first one, on the first moment, is the hook. Never repeat what is said aloud.\n" +
    "   Templates (the app builds timers, reveals, numbering and effects; their moments must also be in moments; template texts are extra to texts):\n" +
    "   quiz recipe: quiz = [{\"q\":question moment,\"ask\":\"question\",\"a\":answer moment,\"answer\":\"short answer\"}]. The q moment must NOT show the answer yet (no highlighted or ticked option); a shows it (a = q only if the answer appears later in that same moment). Leave the last one without a/answer so viewers answer in the comments.\n" +
    "   list recipe: list = [{\"m\":M,\"text\":\"point\"}], one per point (the app numbers them). before-after recipe: before = {\"m\":M,\"text\":\"...\"}, after = {\"m\":M,\"text\":\"...\"}.\n" +
    "   ending (optional, any recipe): a big closing line on the last moment, e.g. a question for the comments.\n" +
    `   marks (optional, max 4, only where they add energy): {"m":M,"type":"sticker","name":one of [${listStickers().join(", ")}]} or {"m":M,"type":"confetti"|"sparkle"|"burst"}.\n` +
    "4. Optional: slow = moment numbers to play in slow motion (a dramatic action, never speech); framed = INPUT numbers (the \"Input 2\" kind, never moment numbers) that are screen recordings / app or game UI; emphasis = up to 3 speech line numbers (#) that are the key sentences.\n" +
    "5. If there is speech: subs = one string per speech line, same order, fixed for mis-heard words (e.g. 'گانلود' → 'دانلود'), in the creator's content language (translate if needed), no emoji. subtitles = true if the words matter.\n" +
    (moods.length ? `6. music: one of [${moods.join(", ")}] or "none".\n` : "") +
    `7. look: one of [${Object.keys(LOOKS).join(", ")}] ("natural" if it already looks good). coverFrom: {"m": the best-looking moment}, cover: max 5 words.\n` +
    "8. The post: caption (WITHOUT hashtags), hashtags, 3 alternative hooks, cta (max 4 words), up to 2 short tips.\n\n" +
    "The app does all timing, cuts, transitions, animation, sound and length. " +
    'Reply ONLY with JSON: {"recipe":"...","moments":[1,4,7],"texts":[{"m":1,"text":"...","pos":"top"}],"quiz":[],"list":[],"ending":"","marks":[],"slow":[],"framed":[],"emphasis":[],"subtitles":false,"subs":[],' +
    (moods.length ? '"music":"...",' : "") +
    '"look":"natural","coverFrom":{"m":4},"cover":"...","cta":"...","hooks":["..."],"caption":"...","hashtags":["#..."],"tips":[]}'
  );
}

async function mockMomentPlan(moments) {
  await new Promise((r) => setTimeout(r, 800));
  // demo: the best-scoring moments in time order, a hook on the first
  const pick = [...moments].sort((a, b) => b.score - a.score).slice(0, 4).sort((a, b) => a.n - b.n || a.s - b.s).map((m) => m.id);
  return {
    data: { recipe: "promo", moments: pick, texts: [{ m: pick[0], text: "(دمو) اینو ببینید", pos: "top" }], look: "vivid", coverFrom: { m: pick[0] }, cover: "نمونه دمو", cta: "فالو کن", hooks: ["اینو ببینید"], caption: "(نمونه‌ی دمو) کپشن ریلز", hashtags: ["#دمو"], tips: [] },
    usage: { tokens: 0, cost: 0 },
  };
}

function reelRules(moods) {
  return (
    "You are ONE creator's video editor and copywriter. Make a vertical short (Reels/Shorts) from their raw inputs and write the post, in their exact voice.\n\n" +
    `Recipe: pick the editing format that fits, one of [${RECIPE_NAMES.map((r) => `${r} (${RECIPES[r].about})`).join("; ")}]. The app applies that format's pacing, transitions, sound design and text style.\n` +
    "The style profile is how this creator usually writes, and their usual niche. If THIS post's goal or footage is about something else, make the post about that: " +
    "keep their voice, but don't bring in their usual product, topic or call to action unless it really fits.\n" +
    "Editing rules: decide what serves the post's goal. Open with the most striking moment (the first second decides if people stay). If the inputs are only photos, build a 6-15s reel where the on-screen texts carry the story (e.g. a question, then the reveal). Usually 10-30s total (shorter if the material is short; up to 60s if the speech needs it), unless a target length is given: then hit it. " +
    "A clip may carry \"x\":0-1 = where its subject is horizontally when it is off-centre in a wide video (the 9:16 crop follows it; faces are tracked automatically). " +
    "A clip without speech may carry \"speed\":0.3-3: below 1 = slow motion (a dramatic or beautiful moment), above 1 = speed-up (a long boring stretch); it then lasts (e-s)/speed on the output timeline. " +
    "Keep the best, sharpest moments; cut dead time; never cut a spoken sentence in the middle. Clips play in the order you list them. " +
    "On-screen texts use the OUTPUT timeline (seconds from the start of the final reel): a hook from second 0, then a few short punchy lines. " +
    'Use "top" for most texts, "center" only for a big punchline, "bottom" when the top of the frame is busy. Subtitles go at the bottom automatically; set subtitles=true only if the speech matters. ' +
    "framed: input numbers that are screen recordings / app or game UI / slides: they are shown in a frame with room for text, never cropped. " +
    "If there is narration, build the edit around it: keep the clips where the key sentences are said, and let on-screen texts emphasise its key points. " +
    "The narration comes from automatic speech-to-text and may contain mis-heard words (e.g. 'گانلود' for 'دانلود', 'بابوزی' for 'بازی'). " +
    "If there is narration, ALWAYS fill subs with exactly one string per narration line, same order: the line fixed using context, in the creator's content language " +
    "(translate naturally if the speech is in another language). Keep the speaker's words and tone: change a word ONLY if it is not a real word or clearly wrong in context " +
    "(a valid word like 'ببین' stays as it is), keep the same number of words where possible. No emoji in subs.\n" +
    "On-screen texts: max 5 words, NO emoji (use sticker marks for emoji), never repeat what the subtitles already say; while someone is talking keep on-screen text to the hook only. " +
    "Use more on-screen texts on silent parts and photos. Don't let a photo or a still moment run longer than needed. " +
    "Jump cuts, colour matching, sound effects, risers before reveals and safe zones are handled automatically, so don't plan for those. cta: a short call to action (max 4 words) for the end card. If the footage lacks variety, one tip may name the shot to film next time (a close-up, a detail shot, a wide shot).\n" +
    (moods.length
      ? `Background music: pick the mood that fits the post from [${moods.join(", ")}], or "none" if music would hurt it (e.g. calm talk where every word matters). It ducks under speech automatically.\n`
      : "") +
    `Look (colour grade of the whole reel), one of [${Object.keys(LOOKS).join(", ")}]: fit the creator's style and the mood; "natural" if the footage already looks good.\n` +
    "Transitions and text animations come from the recipe automatically (a continuous take gets a plain cut). Optional per text: \"anim\":\"highlight\" for the key answer / reveal, \"shake\" for a punchline.\n" +
    "emphasis: up to 3 narration line numbers (#) with the key sentences: they get a punch-in zoom and an impact sound.\n" +
    'marks (optional, max 6, use where they add energy, not everywhere): {"type":"arrow"|"circle","t","d","n":input,"x":0-1,"y":0-1} with x,y = where it is in THAT input\'s frames you saw ' +
    '(arrow tip lands on it); {"type":"bar","t","d"} = a countdown bar that empties over d seconds (quiz timer, "wait for it"); ' +
    (listStickers().length ? `{"type":"sticker","name":one of [${listStickers().join(", ")}],"t","d","x","y","s":size 0.15-0.4} a colour emoji that bounces in (x,y in the final 9:16 frame, or add "n" for a spot in that input); ` : "") +
    '{"type":"sparkle"|"burst","t","x","y"} stars / comic speed lines around a spot (a reveal, a win); {"type":"confetti","t"} (celebration); ' +
    `{"type":"leak","t","style":one of [${LEAK_STYLES.join(", ")}]} a 2 s light-leak glow (intro, a warm/emotional moment, over a transition).\n\n` +
    'Reply ONLY with JSON: {"recipe":"...","clips":[{"n":1,"s":0.0,"e":4.2}],"framed":[],"texts":[{"t":0,"d":2.5,"text":"...","pos":"top"}],"marks":[],"subtitles":true,"subs":[],' +
    (moods.length ? '"music":"mood or none",' : "") +
    '"look":"natural","emphasis":[0],"coverFrom":{"n":1,"s":2.0},"cover":"cover text, max 5 words","cta":"...","hooks":["3 alternative first lines"],"caption":"post text WITHOUT hashtags","hashtags":["#..."],"tips":["max 2 short tips"]}'
  );
}

/**
 * "Revise": the creator asked for a change after seeing the reel. Text only (no frames, no speech-to-text): the previous plan +
 * the narration lines + their note → the full updated plan. Much cheaper than a new edit.
 */
export async function revisePlan(profileText, prevPlan, transcript, note, inputsInfo, moods = []) {
  if (demoMode) {
    await new Promise((r) => setTimeout(r, 1200));
    return { data: { ...prevPlan, tips: [`(دمو) درخواست بازبینی: ${note}`] }, usage: { tokens: 0, cost: 0 } };
  }
  const content = [
    { type: "text", text: `Inputs: ${inputsInfo}` },
    ...(transcript.length ? [{ type: "text", text: "Narration lines: #index input [start-end] text\n" + transcript.map((s, i) => `#${i} ${s.n} [${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join("\n") }] : []),
    { type: "text", text: `The edit plan you made before:\n${JSON.stringify(prevPlan)}` },
    { type: "text", text: `The creator watched the reel and asks: "${note}"\nReturn the FULL updated plan JSON (same format). Change only what the request needs; keep everything else as it was.` },
  ];
  return call(`${reelRules(moods)}\n\nCREATOR STYLE:\n${profileText}`, content, PLAN_LIMIT, "revise");
}

async function mockReelPlan(inputs) {
  await new Promise((r) => setTimeout(r, 1500));
  // demo plan (no API key): every input for up to 3 s, so all the local editing still runs
  const clips = inputs.slice(0, 5).map((i) => ({ n: i.n, s: 0, e: i.type === "image" ? 2.5 : Math.min(i.duration, 3) }));
  const v = inputs.find((i) => i.type === "video") || inputs[0];
  return {
    data: {
      recipe: "promo", clips, texts: [{ t: 0, d: 2.2, text: "(دمو) اینو ببینید", pos: "top", anim: "words" }], subtitles: true,
      marks: [{ type: "sticker", name: "eyes", t: 0.3, d: 2, x: 0.8, y: 0.3, s: 0.22 }],
      transitions: [], cta: "فالو کن", look: "vivid",
      coverFrom: { n: v.n, s: 0 }, cover: "نمونه دمو", hooks: ["اینو ببینید"], caption: "(نمونه‌ی دمو) کپشن ریلز", hashtags: ["#دمو"], tips: [],
    },
    usage: { tokens: 0, cost: 0 },
  };
}

/** One call per post. */
export async function generatePost(profileText, media, brief) {
  if (demoMode) return mockGeneration(media, brief);
  const isVideo = media.kind === "video";
  const content = [
    { type: "text", text: isVideo ? "New video (frames in order):" : media.frames.length > 1 ? "New carousel post:" : "New photo:" },
    ...media.frames.map(img),
    { type: "text", text: `Goal / topic of this post: ${brief || "(none, pick the best angle from the media)"}` },
  ];
  return call(
    "You write social posts for ONE creator, in their exact voice. It must read like they wrote it, not like AI.\n\n" +
      `CREATOR STYLE:\n${profileText}\n\n` +
      "Follow the length / emoji / hashtag / ending rules exactly. " +
      'Reply ONLY with JSON: {"hooks":["3 short alternative first lines"],"caption":"post text WITHOUT hashtags","hashtags":["#..."],"cover":"cover/thumbnail text, max 6 words",' +
      `"scenes":${isVideo ? '[{"t":"0-3s","v":"what to show","x":"on-screen text / voice-over"}] (3-5 scenes)' : "[]"},"tips":["max 2 short posting tips"]}`,
    content,
    1500,
    "post"
  );
}
