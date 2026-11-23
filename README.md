# محتواساز — Content Creator Expert (demo)

Mobile-first Persian app: select a fixed editing template, upload raw videos, complete missing parts in chat,
and render with that template. The former global style questionnaire and brand settings are retired.

## Template creation (current flow)

Conversation handling is now separated from the template adapter: `src/conversation.js` owns the dialogue schema, role-aware history, pending questions, persistent goal/constraints, file-to-message relationships and generic operation checks. `src/template-conversation.js` supplies the active template's editable targets/capabilities and stable product IDs. Each real turn returns both a proposed selection and a dialogue decision. Clarification questions can offer dynamic buttons with exact question/choice IDs; free text retains the question context. Informational replies preserve selections; valid partial plans can request missing evidence. Unresolved/unsupported requests and claims of unexecuted changes block rendering; cancellation restores the previous resolved memory. Revision rendering independently rejects an unchanged timeline/caption before quota consumption. This is a general conversation contract, not a collection of Persian phrase cases. Offline contract/request-assembly tests do not establish real-model comprehension quality; no paid development requests were used.

Completed template videos support **اصلاح این نسخه**. An explicit request reopens the same chat using the selected job's immutable analysis/media snapshot, with its output timestamps as context. Source speech is cached; new media can be supplied in chat. The fixed template still owns rendering. Requests are bounded to evidence selection and reviewed transcript corrections, not arbitrary effects or speech synthesis. The user reviews the selection and explicitly renders a new job; previous exports and version links remain available. Each new render counts toward the reel quota. Another active draft must first be completed/discarded. Revision requires retained source media (default 7 days); expired sources return an explicit error rather than silently editing the compressed export. Natural-language revision interpretation has not been tested with paid AI during development.

The active frontend is React + TypeScript in `web/`. Run `npm run build:ui` after changes (`npm start` builds automatically). `public/index.html` loads the generated assets under `public/ui/`; legacy `app.js`, `template-flow.js`, and `media-ui.js` are not loaded. Optional compression still uses `public/media-prep.js`.

Chat state, recording, uploads, and local draft persistence have separate lifecycles. Uploads retain 4 MiB resumable chunks; retrying a message uses an idempotency key to avoid duplicate analysis. Pending text/media persist in IndexedDB, and discard requires confirmation. `npm run typecheck` and `npm run test:ui` verify the frontend without paid AI requests.

- One active template: **معرفی محصول** (`product-presenter`, v1). Opening presenter → product sections → closing presenter.
- Upload one raw take or multiple videos. The service transcribes new media once, caches it, and asks for missing
  template slots. Supplementary audio/video is attached to the same persistent chat; replies are at most 12 words.
- Record audio/video, play it locally, discard or rerecord, then explicitly send. Camera/microphone require HTTPS
  or localhost. File selection works without capture permission. A reply automatically targets the pending request;
  tapping a missing requirement changes the reply context, with no dropdown.
- The model selects existing segment/frame IDs, never layout, music, effects, speed or inherited creator preferences.
  One usable angle per product suffices. Uncertain recognition requires confirmation; absent essential evidence blocks
  rendering. Audio supplements need enough related product footage to cover their duration without looping.
- Fixed renderer: 720×1280 / 30 fps, natural-speed cuts, original audio, no music/denoising/SFX, white Vazirmatn subtitles.
  A separate matching video can cover presenter speech; independent audio plays over matching product footage.
- `PRODUCT_TEMPLATE_SAMPLE_URL` optionally supplies a sample video in the template gallery. Without it, the card
  explicitly shows a structure diagram, **not a claimed video sample**. No personal footage is published as a sample.
- Demo mode does local media inspection but never pretends to recognize speech/products; it keeps requirements open.
- APIs: `/api/templates`, `/api/edits`, `/api/edits/:id/messages`, `/analyze`, `/confirm`, `/render`.
  Raw chat media/frame routes require the owner’s authentication. Legacy creation and style routes return 410.
- Chat/evidence and cached transcripts live in `DATA_DIR/db.json` and `DATA_DIR/jobs/edit-<id>/`; jobs snapshot
  template/evidence before rendering. Interrupted analysis is not automatically retried on startup.
- Each account has **one active draft**. Creating another returns that draft. Discard uses an explicit confirmation
  modal; the server archives the chat and allows a new draft. Unsent text, captured files and transcript edits are
  saved in IndexedDB per account; quota/storage errors are shown immediately. Browser storage is device/origin-specific.
- Chat has its own scroller and fixed composer, a paperclip attachment drawer, custom waveform audio/video players,
  live microphone metering, and a three-dot processing indicator. Unchanged polls don't rebuild the interface.
- Whisper input is now lossless mono WAV. Transcript suggestions must be reviewed; user corrections are locked and
  cached, with phrase subtitles when old word timings no longer apply. This does not guarantee ASR accuracy.
- Optional browser compression preserves the original and requires preview approval. It runs at playback speed;
  unsupported codecs, hidden pages, failed or ineffective conversion fall back to direct upload. A synthetic desktop
  test reduced 10.9 MB to 2.8 MB in 3 seconds with audio and 1080p retained; phone/quality review remains necessary.
- `MAX_UPLOAD_MB=1024` is the default per-file cap. Uploads remain 4 MB resumable chunks, even after compression.
- Template video segments are encoded once (CRF 21, max 4 Mbps at 720p); final joining copies video. Intermediates are
  removed after successful export. `RAW_RETENTION_DAYS=7` removes raw sources of finished template edits only;
  active drafts and final videos are preserved. Existing legacy jobs are outside this cleanup.
- Isolated preview: `node --env-file=.env scripts/preview-server.mjs`; set `ENABLE_REAL_AI=1` only for approved real
  testing. Data defaults to `data/test-out/template-ui-review`, port 3015. This never uses the main server's database.
- HTTPS preview uses `scripts/preview-tunnel.compose.yml` and `preview.Caddyfile`, the existing MatStack key and staging
  credentials. Configure `STAGING_ENV_FILE` and `PREVIEW_CADDYFILE`; load the tunnel key through Compose's `--env-file`.
  The app uses `X-Creator-Token` so HTTP Basic auth remains intact; inline media uses an HttpOnly scoped cookie.
- Checks: `npm run test:templates` (offline API + synthetic render), `test:plans`, `test:uploads`.
  Real AI recognition and actual phone microphone/camera capture still need separate verification.

## Run
```bash
npm install
cp .env.example .env   # fill GAPGPT_API_KEY (and optionally Kavenegar for real SMS)
npm start              # prints the address to open on your phone (same Wi-Fi)
```
Without Kavenegar settings the login code is shown on screen (demo). Without a GapGPT key the app returns sample output.

## Plans and admin
- `ADMIN_PHONE` = your number: you get **Settings → پنل مدیریت**: every user, their plan, an optional end date, a note,
  their use (today / last 30 days, tokens); edit plans (reels per day, reels per 30 days, posts per day; empty = unlimited,
  0 = not allowed) and the plan new users get.
- New users get the default plan, **غیرفعال** at first: they can sign in but make nothing until you give them a plan
  (an invite-only beta). Failed jobs do not count. "Today" is the day in Iran. The admin has no limits.
- Test it without tokens: `node scripts/admin-ui-server.mjs` → http://localhost:3011/creator/ (admin 09120000000, own data folder).

## Under a path (BASE_URL)
`BASE_URL=/creator npm start` serves everything at `/creator/` (`/creator` redirects there), so several apps can share one
domain / container behind a reverse proxy. The page uses only relative URLs, so a proxy that strips the prefix works too.

## Docker: keep the data (volume)

Everything the app writes lives under `DATA_DIR` (default `./data`): `db.json` (users, plans, jobs), `uploads/`
(photos, logos), `parts/` (resumable uploads), `jobs/<id>/` (input videos + finished `out.mp4` / covers),
`usage-log.jsonl`, `beats.json`. Point it at a mounted volume and nothing is lost when the container is rebuilt:

```bash
docker run -e DATA_DIR=/data -v creator-data:/data ...        # named volume
docker run -e DATA_DIR=/data -v /srv/creator:/data ...        # or a folder on the host
```

(compose: `environment: [DATA_DIR=/data]`, `volumes: ["creator-data:/data"]`.) Only temporary files (voice notes
while being turned into text) go to the system temp folder and are deleted right away.

## Stack
- Node.js + Express, JSON file storage in `data/` (no database)
- GapGPT (OpenAI-compatible) via the `openai` SDK — `src/ai.js`
- Background job queue (several posts at once, survives leaving the page/restarts) — `src/jobs.js`
- Phone + one-time-code login, Kavenegar SMS — `src/auth.js`
- Plain HTML/CSS/JS single-page app, RTL, installable to home screen — `public/`

## Legacy video pipeline (historical jobs / offline fixtures)
Videos (one or several, merged) are uploaded to this computer and edited with ffmpeg (`ffmpeg-static` package):
the AI sees ~8 small frames + the Whisper transcript and returns one plan (which parts to keep, Persian on-screen texts, subtitles on/off, cover),
then ffmpeg renders a 720x1280 reel (blurred background for landscape clips), burns texts/subtitles with the Vazirmatn font, and makes a cover.
Code: `src/reel.js`, `src/media.js`. If a fresh `npm install` skips the ffmpeg download, run `npm approve-scripts ffmpeg-static` and install again.

Pro edit (all local, no extra tokens):
- **Karaoke subtitles**: Whisper word timestamps; ≤3 words per line, the spoken word turns yellow.
- **Jump cuts**: pauses in speech (`silencedetect`, -32 dB, ≥0.45 s) are cut out; every other piece gets a 110% punch-in.
- **Clean audio**: high-pass + FFT denoise on speech, whole mix normalised to -14 LUFS (Instagram level).
- **Music**: tracks in `assets/music/<mood>/` (folder name = mood). Starter library: 13 CC0 tracks from Wikimedia Commons
  (energetic, chill, emotional, funny, epic; `npm run music`, list in `assets/music/CREDITS.txt`). Add your own any time.
  The AI picks a mood (or none); the track is beat-tracked (cached in `data/beats.json`), shot changes snap to the beat,
  and the music ducks under the voice.
- **Sound effects**: real recordings from `assets/sfx/whoosh/`, `assets/sfx/pop/`, `assets/sfx/impact/` (any wav/mp3; rotated so
  they don't repeat). Whoosh on moving transitions, impact on key sentences and big centre texts, pop when a headline appears.
  An empty folder = no sound of that kind. Free sources: Kenney.nl (CC0), Sonniss GDC bundle (royalty-free), Freesound (filter CC0).

Package 2 (also local; the AI only picks names in its one reply):
- **Scene detection**: the ~8 frames for the AI are taken one per shot (`select=scene`), and the AI is told where shots change.
- **Smart crop**: landscape clips with a face (face-api tiny detector on TensorFlow.js WASM, `src/vision.js`) become a full 9:16 crop that pans with the face.
- **Punch-in**: up to 3 key sentences chosen by the AI get a 120% zoom aimed at the face (max 4 s) + impact sound.
- **Transitions** (`TRANSITIONS` in `src/media.js`, ffmpeg `xfade`): whip, slide, push, zoom, flash, dip, fade, circle, pixel, blur, wind, slice…; the AI picks one per shot change.
- **Looks** (`LOOKS`): natural, bright, vivid, warm, cool, cinematic, vintage, bw, moody, pop; plus per-input brighten for dark footage.
- **Motion text** (`TEXT_ANIMS`, libass): pop, slide-up, slide-right, words (word by word), bounce, shake, highlight (yellow box), wipe (right→left reveal).
- **Shapes** (ASS vector drawing): countdown `bar`, `arrow` and `circle` pointing at a spot the AI saw in an input frame (mapped into the 9:16 layout).
Level 2 overlays (marks types, chosen by the AI):
- **Stickers**: colour emoji PNGs in `assets/stickers/` (Google Noto Emoji, Apache 2.0; `npm run stickers` downloads 24 of them), bounce in, fade out, end with their shot.
- **Light leaks**: `warm`, `pink`, `gold`, drawn by ffmpeg itself on first use (`assets/overlays/`), screen-blended at 75%.
- **Particles** (libass drawings): `confetti`, `sparkle` (twinkling stars), `burst` (comic speed lines). Burst → impact sound, sticker/confetti → pop.
"20 years of experience" (the craft is code, the AI only names things — no extra tokens):
- **Recipes** (`src/recipes.js`): quiz, list, before-after, tutorial, story, hook, promo, talk. The AI names one; the code applies
  its transition family (and never the same fancy transition 3× in a row), text-animation family, max time on a still,
  default music mood, risers, texts on the beat (promo), calm mode (story/talk: soft transitions, no pop on every text, quieter music).
- **Hook rule**: something is on screen from frame 1 (the first hook line, word by word, if the plan had no text at 0).
- **Safe zones** (`SAFE` in `src/media.js`): no text / sticker under the Reels/TikTok UI (top 120 px, bottom 290 px, right 120 px).
- **Framed** inputs (screen recordings, UI, slides; also auto-detected from a phone-screen ratio): shown in a bordered box,
  top band free for text, never cropped or colour-"fixed".
- **Wide footage** (cinema 2.4:1, low-res, small faces): a large 4:5 window following the faces instead of a thin strip.
  Two similar faces (dialogue) → framed between them.
- **Sound design**: before each big reveal a riser (an impact recording played backwards, `assets/sfx/riser/`) builds up and
  the music drops out for ~0.4 s, then the hit lands.
- **Radio voice**: de-esser, compressor, EQ (less mud at 180 Hz, more presence at 3.2 kHz) on every speech clip.
- **Colour matching**: each camera clip is measured (`signalstats`) and dark / dull / over-bright footage is corrected before the look.
- **Brand kit** (Settings → برند من): accent colour (highlight box, bar, arrow, karaoke word, punchline), @handle, logo,
  logo watermark (top-left, safe zone), 1.6 s outro card (logo + CTA + handle). Copied onto each reel when it's made.
- **Revise + taste memory**: 👍/👎 and "دوباره ادیت کن" on a finished reel. A revise is one text-only AI call (old plan + note → new plan),
  no new upload / frames / speech-to-text. Notes are remembered and added to the next reels' style (last 6, a few dozen tokens).
- **Prompt caching friendly**: the long rulebook comes first and is identical on every request; the creator's style comes last.
Debug the cut list with `DEBUG_REEL=1`.

Testing without spending GapGPT tokens: `npm run test:reel` (or `npm run test:reel -- motion`) renders hand-written plans
from `data/test-fixtures/` into `data/test-out/` (video, cover, 1-frame-per-second sheet, loudness and duration checks).
UI testing without tokens and without touching real data: `npm run demo` → http://localhost:3010 (data in `data-demo/`, demo AI).
Test footage: your own clips + Tears of Steel (CC-BY, Blender Foundation; English dialogue with the human Persian subtitles)
+ CC0 / public-domain clips from Wikimedia Commons (`node scripts/get-footage.mjs`).

## Token saving
- Videos never get uploaded: the phone takes 4 small frames (≤480px); photos are shrunk to ≤768px.
- Style is turned into a short text profile once and cached; with no samples there is no AI call at all.
- One request per post, `reasoning_effort: low`, capped output. Token use is shown per post and in settings.
