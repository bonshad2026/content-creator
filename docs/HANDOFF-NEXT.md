# Start here: handoff for the next agent (2026-11-17)

Read this first. `docs/HANDOFF.md` is the long history (plan P0–P2, progress log since 2026-11-15); use it for
background, not as the current plan. `README.md` covers running, plans/admin, BASE_URL and the Docker volume.

## 1. The product in one paragraph

A mobile-first web app, Persian UI, Instagram first. A creator logs in with a phone number (Kavenegar OTP), describes
their style once, picks photos/videos, adds a brief (typed or spoken), and gets a finished vertical reel ("ریلز") with
subtitles, texts, music and cover, plus caption and hashtags. Node (ESM) + Express 5, ffmpeg (ffmpeg-static or
`FFMPEG_PATH`), a JSON-file db, GapGPT (OpenAI-compatible API) for the AI. It is meant for real users (the user lets
colleagues try it), with an admin who assigns plans.

## 2. The situation right now (most important)

**The user's verdict: the reels are bad.** "Random emojis anywhere, the sound gets ruined, it gives something silly."
After many rounds of rule tweaks, re-renders and paid comparisons, they are tired of that loop and do not want more
token-burning experiments. Our own rubric (`scripts/rubric.mjs`) scored these outputs ~0.9 — **the rubric does not
measure what the user sees; do not use it as proof of quality.**

When the user rejected another "simpler defaults + re-render the saved plans" proposal ("that's the same thing we did
a million times"), the agreed direction became:

- **Human-designed templates**, where the AI does not make visual/sound decisions. Template fixes layout, rhythm,
  text style, audio rules; the AI only fills slots (which moments, order, short texts, caption). This is how CapCut
  templates, Captions, Filmora AutoCut, Quik, Google Photos memories work (none lets an LLM place effects freely).
- Optionally **"suggest, then render"**: show the chosen clips + texts, the user removes/reorders/edits with a few
  taps, then render. (Proposed; the user has not said yes or no.)

Three templates were proposed in chat (details in section 3). **The user has not approved building them yet.**
The last thing they asked before this handoff was about image editing via GapGPT (section 4). Ask before building.

## 3. The three proposed templates (not built)

Shared rules for all: original audio untouched except loudness; no emojis, stickers, SFX, light leaks, speed changes;
plain cuts (one short fade at the end); one font (Vazirmatn bold), white with shadow, one accent colour from the brand
kit; cover = best opening frame + hook text.

1. **"حرف بزن" (talking head).** 0–3 s: the strongest sentence first + big hook text (≤6 words) top third. Middle:
   speech in original order, only pauses >0.5 s between sentences removed; word-by-word subtitles lower middle, two
   lines; gentle 100%↔110% zoom every few sentences. End: last full sentence + 1.5 s end card (handle, "فالو کن").
   No music. AI: opening sentence, which parts to keep for the target length, hook text, subtitle fixes, caption.
2. **"معرفی محصول" (product, no speech).** 0–2 s best shot + hook; 2–12 s 4–5 shots of 2–2.5 s cut on the beat, one
   short benefit line per shot at the bottom; 12–15 s end card (best product shot, "برای سفارش دایرکت بده", handle).
   One calm track at fixed level. AI: shot choice/order, hook, per-shot lines, caption.
3. **"دورهمی خانوادگی" (family gathering: birthday, Yalda, Nowruz).** 0–2 s happiest moment + occasion text;
   middle 6–10 shots of 1.5–2.5 s on the beat in a fixed order (arrivals → table/food → faces → games/laughter →
   group shot), photos 2 s with a slow zoom; 1–2 "voice moments" where music dips and real sound (laughter, a kid's
   line, a toast) plays, subtitled; end: group/wide shot + short closing line + date, slow fade. One warm music track,
   original audio very low except voice moments; one mild warm grade on all shots; 15 s if <8 shots else 30 s.
   No CTA. Never: blurry, dark, very shaky or duplicate shots. AI: order, voice moments, opening/closing text, caption.

The existing code has pieces to reuse: moments mode (`src/moments.js`, `AI_PLAN_MODE=moments`: the model picks
numbered moments, code expands them), recipes (`src/recipes.js`), beat grid and silence detection (`src/media.js`),
audio classes (`src/audio.js`), face tracking (`src/vision.js`). A template could be a new recipe kind where the plan
schema (`src/plan.js`, zod) only allows slot fields.

## 4. Findings about GapGPT (checked, no tokens spent)

- **Video generation (Veo 3.1 / 3.1 Fast, Kling v2.5 Turbo, Gemini Omni) exists only in GapGPT's chat website**
  (`gapgpt.app/chat/models`, "پرومکس" plan), **not in the API**: `/v1/videos` and `/v1/video/generations` → 404,
  model ids unknown, not in `/v1/models` (115 models). They generate new clips from text/image; none says it edits the
  user's own video. Not usable for this app unless GapGPT adds them to the API (the user may ask GapGPT support).
- **Image editing is in the API**: `POST /v1/images/edits` answers "image is required" (endpoint exists) for
  `gpt-image-2`, `gemini-2.5-flash-image`, `gapgpt/qwen-image-2.1` (~$0.005 per megapixel per their price page).
  Others in the list: `gemini-3-pro-image-preview`, `gpt-image-2.5-*`, `gpt-image-2.6-*`, `gapgpt/z-image`.
  **Quality and real price untested.** Proposed uses: fill a photo out to 9:16, clean/replace a busy product background,
  make a cover. Risk: models change product text/faces → make it opt-in with a preview. A small paid test (one photo,
  2–3 models) was offered; **not approved yet**.
- `/v1/images/generations` with multipart fell back to "dall-e" and failed; send JSON if you need it.
- Whisper: `whisper-1` works through the same key. GapGPT rejects browser webm ("webm duration parsing requires full
  EBML parser"); voice notes are re-encoded to mp3 first (fixed in `770aa8d`, **not yet confirmed with a real voice
  note**).
- Gemini models are in the API (`gemini-3.1-pro-preview`, `gemini-3.8-flash`, …). Whether GapGPT passes **video input**
  to them is unknown; a "Gemini watches the whole video as director" test was offered, not approved.

## 5. What was built in the last days (all committed and pushed to `origin/main` unless noted)

- `cbb020c` **Resumable uploads** (`src/uploads.js`): 4 MB chunks with `Upload-Offset`, resume after drops (bytes of a
  cut chunk are kept), per-user fingerprint so the same file is never re-sent, hard-linked into the job folder, swept
  after 3 days, refused up front if the plan allows no reel. `POST /api/reels` takes `files[].upload`.
- `28100c2` Cancel upload; Persian message for `NotReadableError` (phone lost access to the picked file); per-file
  progress on each tile (%, MB sent of total, MB left); **create page is a draft** in IndexedDB
  (`creator-draft:<path>`, files + fields, cleared on send/logout); bigger brief/revise boxes with a **mic inside the
  box** (`POST /api/voice`, Whisper "fa", 40/day/user, mic only on HTTPS/localhost); home shows "در حال ساخت" card apart
  from the "ساخت ریلز جدید" button; wording "ریل" → "ریلز" everywhere; `usage-log.jsonl` moved under `DATA_DIR`.
- `770aa8d` Voice: re-encode to mp3 before Whisper; whitespace regex fix.
- **Uncommitted:** the in-progress count on the home tab is now a badge on the icon's corner
  (`public/app.js` `#tabbar` home link, `public/style.css` `#tabbar .badge`). Checked in the browser. Commit it.
- Earlier: plans + admin panel + `BASE_URL` (`cbc2818`), deploy readiness: atomic db writes, flush on SIGTERM,
  `/api/health`, `FFMPEG_PATH` (`49de3e5`).

## 6. How to run and check things

- App: `npm start` (reads `.env`). The user's own server runs on **port 3002**; **never restart it silently.**
- UI checks with zero tokens: `node scripts/admin-ui-server.mjs` → `http://localhost:3011/creator/` (demo AI, own data
  in `data/test-out/admin-ui`, fake admin `09120000000`, the OTP is returned as `devCode` by `POST api/auth/send`).
  `.claude/launch.json` has it as `admin-ui`. In the browser pane you can fake inputs: override
  `HTMLInputElement.prototype.click` to set `this.files` via `DataTransfer`; fake a mic with an `AudioContext`
  oscillator → `createMediaStreamDestination().stream`; slow uploads by wrapping `XMLHttpRequest.prototype.send`.
  A real tiny video for demo reels: copy `data/test-fixtures/silent.mp4` into `data/test-out/admin-ui/uploads/` and
  `fetch("uploads/…")` it.
- Tests (offline, 0 tokens): `npm run test:uploads` (14), `test:plans` (19), `test:moments` (32), `test:reel`
  (25 render cases, slow), `test:audio`, `test:ai`, `test:length`, `test:plan`, `test:style`. `npm run rescore`
  re-scores saved real runs. Real model plans are saved in `scripts/fixtures/real-plans-v2/` (12 plans: talk / film /
  broll / mixed × opus-old / opus-moments / haiku-moments) — re-render them for free.
- `.env` keys: `GAPGPT_API_KEY`, `GAPGPT_BASE_URL`, `AI_MODEL` (now `claude-opus-5-5`), `PORT`, `KAVENEGAR_API_KEY`,
  `KAVENEGAR_TEMPLATE`, `BASE_URL` (`/creator`), `ADMIN_PHONE`, optional `FFMPEG_PATH`, `DATA_DIR`. **Never print
  secret values.**
- Docker: everything persistent is under `DATA_DIR`; run with `-e DATA_DIR=/data -v creator-data:/data`.

## 7. Rules from the user (keep them)

- Very short answers, in Persian when the user writes Persian. No jargon dumps.
- **No GapGPT tokens on development tests unless the user explicitly asks for a real run.** Say the cost first.
- Free forever: open-source tools, CC0 / public-domain assets only.
- Videos never go in git. Tests write only to `data/test-out/` or `data/jobs/_test-*`, never to the real `data/`.
- `arcane.mp4` is copyrighted: local tests only, never publish results.
- Commit only when asked (the user often says "commit" / "push"). End commit messages with the Co-Authored-By line
  the harness gives you.
- Before building something big, propose it and get a yes; the user rejects repeating the same loop.
- Say plainly what was not verified.

## 8. Not verified / open

- Real voice note through GapGPT after the mp3 fix.
- Real Kavenegar SMS on the deployed server; real phone tests of resumable upload / draft / mic.
- Existing users in the real `data/db.json` have no plan → blocked until the admin assigns one.
- Public-beta gaps: limit on parallel renders, upload length limit (only size is limited, 400 MB), old-job cleanup,
  hosting choice, default model for the beta, SIGTERM on real Linux.
- Whether GapGPT will expose video models in the API, and whether Gemini via GapGPT accepts video input.

## 9. Suggested next step

Ask the user which of these to do, in this order of value:
1. Build **one** template end to end (talking head, or family gathering if they prefer), with the AI limited to slot
   choices, and show the result on the user's own footage. One real run only with their approval.
2. The small paid image-edit test (9:16 fill / background) on one product photo.
3. Commit the tab-badge change.
