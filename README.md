# محتواساز — Content Creator Expert (demo)

Mobile-first web app: log in with your phone number, describe your style in a few taps, upload photos/videos,
and get ready-to-post captions, hooks, hashtags and video scripts written in your style.

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

## Stack
- Node.js + Express, JSON file storage in `data/` (no database)
- GapGPT (OpenAI-compatible) via the `openai` SDK — `src/ai.js`
- Background job queue (several posts at once, survives leaving the page/restarts) — `src/jobs.js`
- Phone + one-time-code login, Kavenegar SMS — `src/auth.js`
- Plain HTML/CSS/JS single-page app, RTL, installable to home screen — `public/`

## Video reels
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
