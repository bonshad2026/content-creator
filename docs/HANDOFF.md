# Handoff plan: content-creator-expert

Written 2026-11-15 for whoever continues this (a person or a model). Read this before changing code.

## 1. What the product is

A mobile-first web app (Persian UI). A creator logs in with a phone number, describes their style once, uploads
photos/videos with a one-line brief, and gets back a finished vertical reel (cut, subtitles, text, music, sound, cover)
plus caption and hashtags.

The user's standing requirements:
- **The first run must be the best result.** Users know nothing about editing. No iteration unless they ask for a revise.
- **Token frugal.** One AI request per reel. Heavy work is local ffmpeg.
- **Free forever.** No paid licences. Only open-source tools and CC0 / public-domain / Apache assets.
- **Do not spend GapGPT tokens on development tests** unless the user explicitly asks for a real run.
- The user wants very short answers.

## 2. How it works today

```
upload → probe / scene detection / frames (or contact sheet if >60 s)
       → Whisper (speech to text, via GapGPT)
       → ONE Opus request: the edit plan as JSON (src/ai.js planReel)
       → code turns the plan into a timeline (src/reel.js)
       → ffmpeg renders (src/media.js)
```

| File | Lines | Role |
|---|---|---|
| `src/reel.js` | 657 | The whole pipeline in one function (`runReel`). Too big; see P2. |
| `src/media.js` | 699 | ffmpeg: analysis, ASS text/shapes, layout, render, audio mix. |
| `src/ai.js` | ~260 | Prompt (`reelRules`), `planReel`, `revisePlan`, Whisper call. |
| `src/audio.js` | 68 | Audio class per video (`speech` / `music_or_mixed` / `silent`), trusted Whisper lines, level. |
| `src/recipes.js` | 80 | 9 editing recipes (rules in code, the AI names one). |
| `src/vision.js` | 74 | Local face tracking (face-api on TF.js WASM). |
| `src/jobs.js`, `server.js` | | Queue, API, brand kit, feedback, revise. |
| `public/app.js` | 658 | Single-page app. |
| `scripts/test-reel.mjs` | 428 | Offline tests: hand-written plans, 0 tokens. |

Commands: `npm start` (app), `npm run demo` (port 3010, demo AI, separate data), `npm run test:reel` (22 offline render
cases), `npm run test:audio`, `test:ai`, `test:length`, `test:plan`, `test:style` (unit tests, seconds), `npm run token-budget` (planner request size, 0 tokens).
Samples and the earlier report: `demo-output/expert/`.

## 3. What is verified and what is not

**Verified offline (17 tests pass):** every render feature (karaoke, jump cuts, transitions, looks, overlays, brand kit,
safe zones, recipes, slow motion, shot matching, bar cropping).

**Verified with real GapGPT runs (3 total):**
- Short talk + game + photo: good plan, 5,875 tokens.
- Arcane fight, 290 s, run 1: bad (37 s, clips only from the end, black bars).
- Arcane run 2 after fixes: better (55 s, whole fight), but 14,687 tokens and broken sound.

**Not verified:**
- The raised reply limit (3,500 tokens for long edits).
- The Whisper hint-echo filter and the "looped phrase" filter against new real audio.
- `revisePlan` with the real model (only demo mode).
- Prompt caching on GapGPT.
- GapGPT's reported `usage.cost` is inconsistent between runs; real price unknown.
- Anything on a real phone since the upload watchdog was added.

## 4. Known problems, with cause

### A. Sound is damaged on footage that is not a person talking (P0) — fixed by P0-2, see section 9
- **Symptom:** Arcane run 2 sounded "de-noised" although the source was clean.
- **Cause (from the code, not from listening):** Whisper returned 4 junk lines. Any surviving line sets
  `inp.hasSpeech = true`. That one flag then does three things:
  1. `voice: true` → high-pass, `afftdn`, de-esser, compressor and two EQ bands on the **whole film mix** (`media.js:604`).
  2. `duck: true` → the added music is side-chain compressed by the film audio, which is loud all the time (`media.js:668`).
  3. `bg: false` → the film audio plays at full volume against the added music (`reel.js:621`).
- **Also suspect:** single-pass `loudnorm` (dynamic mode) can pump on music.

### B. "Has speech" is decided by Whisper junk (P0) — fixed by P0-2, see section 9
- On music, fights and noise Whisper invents text. Two filters exist (hint echo, looped phrase); a third kind
  (mixed-language nonsense) passed.
- The Persian hint words passed as Whisper's `prompt` likely bias language detection to Persian on English audio.

### C. Token cost is not controlled (P1) — partly fixed by P1-1, see section 9
- A cut-off reply (`finish=length`) is retried blindly and paid twice.
- The rulebook prompt has grown to roughly 1,800 tokens; nobody has measured each part.

### D. Length is only requested, not enforced (P1)
- The brief's length goes to the model as text. 60 s asked → 55 s delivered. Nothing in code corrects it.

### E. The plan is trusted too much (P1)
- Plan JSON is sanitised field by field inside `runReel`. There is no schema, so new fields get ad-hoc checks.
  `zod` is already a dependency and unused.

### F. Style choices that looked wrong in the Arcane reel (P1)
- Cinematic thin text is unreadable on busy footage.
- 13 of 15 joins were hard cuts; the recipe allows nothing else.

### G. No version control — fixed (P0-1)

## 5. The plan

Order matters. Do not start P1 before P0 is done and measured.

### P0-1. Put the project under git
- `git init`, commit the current state, confirm `.gitignore` covers `data/`, `data-demo/`, `.env`, `node_modules/`.
- Decide whether `assets/music` (37 MB) and `demo-output/` belong in the repo.

### P0-2. Classify the audio before deciding anything
Replace the single `hasSpeech` flag with a per-input audio class: `speech`, `music_or_mixed`, `silent`.
- Inputs to the decision (all free or already paid for):
  - Whisper `verbose_json` segment fields: `no_speech_prob`, `avg_logprob`, `compression_ratio`.
  - Share of the clip covered by accepted lines.
  - Local measurements: noise floor and dynamics from ffmpeg `astats`.
- Rules to implement and test:
  - Voice processing only for class `speech`.
  - Noise reduction only when the measured noise floor is actually high.
  - Ducking only for `speech`.
  - `music_or_mixed` source audio: either keep it as the soundtrack and add **no** music, or mute it under added music.
    Never both at full level. This is a product decision; see section 7.
- Stop passing Persian hint words as the Whisper prompt when the language is unknown, or pass the creator's language
  explicitly. Test both on the existing fixtures.
- **Done when:** on `arcane.mp4` the class is `music_or_mixed`, no voice filter appears in the ffmpeg command, and on
  `talk-long.mp4` the class is `speech` with the same subtitles as today.

### P0-3. An audio test that can fail
The offline suite only checks loudness. Add checks that would have caught problem A:
- Assert on the generated filter graph (no `afftdn` / `deesser` for non-speech inputs).
- Compare source and output spectra for a non-speech clip rendered with no music; they should match within a tolerance.
- Use two-pass or linear `loudnorm` and assert true peak and loudness range.

### P1-1. Token budget
- Log tokens per request split into prompt text, images and reply. Do it once on saved inputs before changing anything.
- On `finish=length`: do not resend the same request. Either ask for a continuation or resend with a higher limit once,
  and record that it happened.
- Trim the rulebook: move anything the code already enforces out of the prompt.
- Check whether GapGPT reports cached tokens; if not, stop designing for caching.
- **Done when:** a table of tokens per reel type exists in this file and a cut-off reply costs at most 1.3x.

### P1-2. Enforce length in code
- After the plan is sanitised, if the total is outside ±10 % of the target: trim the longest clips or extend clips into
  unused neighbouring footage, deterministically.
- Add a length chooser to the upload screen (15 / 30 / 60 s) so it does not depend on parsing the brief.

### P1-3. Plan schema
- One `zod` schema for the plan, used by `planReel`, `revisePlan`, manual tests and the demo mock.
- Invalid fields are dropped with a logged reason, not silently.

### P1-4. Style fixes found in the Arcane reel
- Cinematic text: larger, with a soft dark backing when the footage behind it is busy.
- Let cinematic use a few soft transitions on scene changes, not only at the end.
- Review each recipe once against one real reference reel.

### P2-1. Split `runReel`
Stages with plain data between them, each testable alone:
`analyze → transcribe+classify → plan → timeline → overlays → audio plan → render`.
The timeline (pieces, joins, offsets) should be one object with one place that maps "planned time" to "final time";
today that mapping is spread over `mapTime`, speed, jump cuts, beat snapping and transitions.

### P2-2. A real evaluation loop
- Keep every real model plan as a fixture (two exist: `real-opus-plan`, `data/test-out/arcane-plan2.json`).
- A fixed rubric per reel, checked from frames and metrics, written down before looking: length hit, coverage of the
  source, text legible, nothing outside safe zones, audio class handled, loudness.
- A small set of reference inputs covering: talking head, screen recording, photos only, B-roll with music,
  film/animation, mixed.

### P2-3. User controls that remove guessing
- Length, recipe ("auto" by default), "keep original sound", music on/off.
- Each one is a tap on the upload screen and removes a decision the model currently guesses.

### Backlog (not planned yet)
Speed ramps, stabilisation (`vidstab` is in this ffmpeg build), `.cube` LUTs, loop endings, real whoosh sounds
(Sonniss), beat zoom pulses, AI video generation.

## 6. Working rules that prevented nothing so far and should

1. **Diagnose from logs and code first.** The scene-detection bug (only the log tail was read) hid for days because
   results were judged by eye.
2. **One change, one test that can fail.** Several fixes were shipped with only the happy path rendered.
3. **Say what was not verified.** Every hand-off must list it.
4. **No real GapGPT run without the user asking.** Record tokens and what was learned for each one.
5. **Never restart the user's server silently**; it currently runs on port 3002 because 3001 is taken by something
   unknown. Find out what holds 3001.

## 7. Decisions (made by the user, 2026-11-15)

1. **Footage with its own soundtrack** (films, clips with music): **replace it with our music by default.**
   P0-2 implements this: class `music_or_mixed` → source audio muted, our track plays. A later "keep original sound"
   toggle (P2-3) is the only way to keep it.
2. **`assets/music` (CC0, 37 MB) is in the repo.**
3. **No warning for copyrighted footage.**
4. **No target token cost for now.**
5. **The goal is that a cheaper model makes edits as good as Opus does.** This changes the direction of the plan:
   the craft must live on our side, and the model's job must shrink to something "anyone could direct".
   See P1-5 below. Only `claude-opus-5-5` has been tried so far.
6. **Videos never go into git.** The user's uploads, test outputs, generated overlays and samples stay local so the
   user can pick by hand which ones (if any) get committed. `.gitignore` blocks every video extension everywhere.

### P1-5. Make the model's job easy enough for a cheap model (new, from decision 5)
The model should choose, not compose. Concretely:
- **Fewer, simpler decisions.** Today the plan has ~15 kinds of fields (clips with seconds, texts with times,
  positions, animations, marks with coordinates, transitions per cut, emphasis indexes…). Target: the model picks
  *which moments* (by sheet/frame number, not seconds), *a recipe*, *a few short texts*, and *the caption*. Everything
  else (timing, transitions, animations, sounds, positions, music) is derived by code from the recipe and the footage.
- **Pick from numbered options, never invent numbers.** E.g. the contact sheet numbers each moment; the model returns
  `[3, 7, 12, 18]`. The code finds the exact in/out points (scene cuts, motion peaks, silence edges).
- **Recipes become full templates**: slot structure ("hook moment → 3 action beats → reveal → end card"), text slots
  with max words, and the code fills the rest.
- **A local "best moment" scorer** (motion energy, faces, audio peaks, scene cuts) ranks candidate moments before the
  model sees them, so even a weak model only chooses among good ones.
- **Validate and repair in code** (schema, P1-3): a cheap model's sloppy output is fixed, not rejected.
- **Measure it:** run the same saved inputs through Opus and one cheaper model, compare against the P2-2 rubric.
  Only real runs the user approves.

## 8. Local state worth knowing

- Test footage: `data/test-fixtures/` (about 800 MB, not in git). Includes the user's own clips, Tears of Steel
  (CC-BY), six CC0 stock clips, and `arcane.mp4` (copyrighted; local test only, do not publish results).
- The user's real data is in `data/`. Tests and demo mode must never write there except `data/jobs/_test-*` and
  `data/test-out/`.
- `demo-output/` holds every sample sent to the user.

## 9. Progress log

### 2026-11-15 — P0-1, P0-2, P0-3 done (offline only, 0 tokens)
- **P0-1:** repo under git (commit `3886193`), `.gitignore` as in decision 6.
- **P0-2 audio class** (`src/audio.js`, wired in `reel.js` step 2):
  - `transcribe` now returns every line with `noSpeech`, `logprob`, `compression` and the analysed duration.
    **No Whisper `prompt` is sent any more** (the Persian hint list and the hint-echo filter are gone); `language`
    is passed only if known (nothing passes it yet).
  - A line is trusted unless: no_speech ≥ 0.6, avg_logprob < -1, compression > 2.4, most of its words are 0 s long,
    or its script contradicts the detected language (Persian with English loanwords is kept).
  - Class: no audio / RMS < -50 dB → `silent`; trusted lines cover ≥ 20 % of the analysed audio → `speech`;
    else `music_or_mixed` and its lines are dropped.
  - Effects: voice chain only for `speech`; `afftdn` only when the noise floor > -50 dB; ducking only with speech;
    `music_or_mixed` under our music → **muted** (`volume=0`, was 0.3); with music "none" it plays untouched.
    The planner is told "has its own soundtrack (muted under the music you pick)".
  - `output.audio` reports the class per input (e.g. `{"1":"speech+denoise"}`).
- **P0-3 audio tests:**
  - Loudness is now two-pass linear: render with PCM audio → measure (EBU R128) → one fixed gain to -14 LUFS +
    a limiter at -2.5 dB → AAC, video copied; then the true peak is measured and, if still above -1 dBTP, the
    limiter ceiling goes down by the overshoot (max 2 retries). Dynamic `loudnorm` is gone. `KEEP_PRE=<file>` keeps
    the pass-1 mix for debugging.
  - Every render writes `render-filter.txt` in the job folder; `test-reel` asserts on it for every case: no
    voice filters / ducking without speech, no `afftdn` without a noisy input, own soundtrack muted under music,
    no `loudnorm`, true peak ≤ -1 dBTP, loudness -14 ±1 when music or voice is present.
  - New cases: `soundtrack-passthrough` (game audio, no music: tone balance of 3 bands must match the source within
    1.5 dB) and `arcane-soundtrack` (Arcane run 2 replayed from `data/test-out/arcane-plan2.json` with its real
    Whisper junk → `music_or_mixed`, muted, no voice filters).
  - Mutation check done: forcing the voice chain on non-speech makes `soundtrack-passthrough` fail.
  - Full suite: 19/19 after one change: the loudness window is -16..-13 LUFS. Peaky mixes (many sound effects:
    `motion-graphics`, `overlays`) land at about -15.3 because the limiter takes the peaks and the gain is not raised
    again. Peaks above -1 dBTP came
    out now and then (+0.4 … +3.4) and loudness / length changed between identical runs. Causes found: (1) the
    music track and the sound effects were picked with `Math.random` → now seeded from the job id (a revise uses
    its parent’s id), so the same plan always gives the same reel; (2) limiting at 4x rate and resampling back made
    the resampler ring above the ceiling → the limiter runs at 44.1 kHz; (3) `alimiter latency=1` made AAC 1.3 dB
    hotter on the same audio, and hard limiting (a peaky mix pushed up ~10 dB) overshoots between samples after AAC →
    `latency` removed, the ceiling fallback above. Lowering the *gain* instead did not work: the limiter output is not
    monotonic in it (−1.7 dB gain gave a higher true peak).
- **Measured on fixtures** (ffmpeg, first 120 s): level, band energy and silence share do **not** separate speech
  from a film mix (arcane ≈ talk-long), so the class relies on Whisper confidence + coverage. Noise floors:
  talk-long -49, talk-short -45, game -46, arcane -47 dB.

**Not verified (needs a real run the user approves):**
- The new trust thresholds against fresh real Whisper output (only Arcane run 2's saved, already-filtered lines were
  replayed; the saved data has no logprob / compression fields).
- Whether dropping the Whisper prompt hurts Persian accuracy (e.g. "دانلود"). Test on `talk-long.mp4`: same
  subtitles as before is the P0-2 "done when" and is still open.
- The 20 % coverage threshold on a vlog with speech over music (will be classed `music_or_mixed` and muted if the
  person talks less than a fifth of the time).
- How the new loudness pass sounds by ear (all checks are numeric).

**Next:** P1-1 (done below), then P1-2 … as in section 5.

### 2026-11-15 — P1-1 token budget (offline only, 0 tokens)
- **Measured before changing:** `npm run token-budget` builds the exact planner request from saved inputs (real
  analysis, known transcripts, `AI_DRYRUN`, nothing sent) and splits it. Estimates (no offline tokenizer: images
  w×h/750, Persian ~1.6 chars/token, Latin ~3.8):

  | Reel type | Rules | Style | Input text | Transcript | Images (count) | Prompt |
  |---|---|---|---|---|---|---|
  | Talking head, 48 s | 1,589 | 80 | 47 | 302 | 555 (5) | 2,573 |
  | Screen recording, 39 s | 1,589 | 80 | 70 | 0 | 455 (5) | 2,194 |
  | Photos only (2) | 1,589 | 80 | 58 | 0 | 222 (2) | 1,949 |
  | Mixed: talk + game + photo | 1,589 | 80 | 105 | 50 | 788 (8) | 2,612 |
  | B-roll, 5 stock clips | 1,589 | 80 | 148 | 0 | 1,221 (11) | 3,038 |
  | Film 290 s (contact sheet) | 1,589 | 80 | 307 | 0 | 1,573 (1) | 3,549 |

  Rules were 1,733 before the trim. Biggest rule parts: general editing 470, marks 244, on-screen text 231,
  recipes 207, narration/subs 207, JSON format 112. The reply is ~500–700 tokens (Arcane run 2 plan ≈ 516).
  **The rulebook is 45–80 % of every prompt**; images are the only other big part.
- Saved real totals in `data/db.json` (2,000–4,500 per reel incl. reply) agree with these estimates. Arcane run 2's
  14,687 does not: most likely the old blind retry (paid twice) plus reasoning tokens — the new log will show it.
- **Cut-off replies:** `max_tokens` is only a ceiling, so plan/revise now use 6,000 (was 1,800/3,500/2,200). If a
  reply is still cut (`finish=length`), `repairJson` closes it at the last complete array item / top-level key
  (never keeps a half-written clip) → **1.0x cost**. Only if that fails is it re-sent once, with a 1.5x limit.
  Tested in `npm run test:ai` (incl. the real Arcane plan cut at every 10th character).
- **Every real request is logged** to `data/usage-log.jsonl`: label (plan / revise / profile / post), finish,
  prompt, reply, reasoning and **cached** tokens, cost. This answers the caching question on the first real run.
- **Rulebook trim:** transitions and text animations are filled by code from the recipe (and continuous takes get a
  cut), so those rules and the JSON fields left the prompt (−144 tokens). One line keeps the optional
  `highlight` / `shake` hint. Deeper cuts are P1-5's job (the model choosing, not composing).

**Not verified:** real token counts (all estimates), whether GapGPT reports cached tokens, whether the model's
transition choices were better than the recipe's rotation (visible only in real runs).
**Next real run (when the user approves):** one reel from saved inputs, then fill a "real" column in the table
from `data/usage-log.jsonl` and decide on caching.

### 2026-11-15 — P1-2 length enforced in code (offline only, 0 tokens)
- **Upload screen:** "طول ریل" chooser (خودکار / ۱۵ / ۳۰ / ۶۰ ثانیه) → `job.length` (server accepts only 15/30/60;
  a revise keeps its parent's). "Auto" falls back to a length written in the brief (`targetSeconds`), else none.
  Checked in the demo app: the choice reaches the job and is enforced.
- **`src/length.js` `fitLength`** (pure, deterministic), called in `reel.js` step 4b after sanitising the plan:
  - Outside ±10 % of the aim → too long: shorten the longest clip from its end; a cut inside a sentence moves back
    to that sentence's start (it goes out whole); when nothing can shrink, drop the last clip. Too short: grow the
    shortest clip into unused footage after it (then before it, never before the first clip: that's the hook),
    photos up to the recipe's max still; never re-uses footage another clip shows; stops when nothing is left.
  - Aim = target − outro card + transition overlap (0.3 s per join, 0.1 in minimal recipes); after a first fit the
    seconds jump cuts will remove are measured and it fits once more with them added back.
  - A revise whose note talks about length ("کوتاه‌تر", "۳۰ ثانیه", …) is not overridden.
- **Tests:** `npm run test:length` (11 unit cases) and 3 render cases that measure the final file:
  `length-trim-30` (44 s talk → 28.4 s), `length-extend-30` (11 s plan → 30.0 s), `length-arcane-60`
  (the real model's 55 s Arcane plan → 58.2 s).

**Known limits / not verified:**
- Long sentences make the trim coarse: with 8–9 s lines a 25 s aim can end at 21 s (outside ±10 %) rather than
  cut a sentence. By design; revisit if real talks miss often.
- Little material stays short (one photo → 9 s even when 30 s is chosen). The UI does not warn about it yet.
- Jump-cut and overlap corrections are estimates; final length is checked only by the 3 render cases.

### 2026-11-15 — P1-3 plan schema (offline only, 0 tokens)
- **`src/plan.js` `normalizePlan(raw, ctx)`**: one zod schema per field (clips, texts, marks as a discriminated union
  by type, and every top-level field the code reads). It runs once at the top of `runReel` step 4, so the model's
  plan, a revised plan, hand-written test plans and the demo mock all pass the same gate.
  - Each field and each list item is parsed alone: a bad item is dropped, the rest is kept. Clear slips are repaired:
    numbers written as text, clip in/out swapped, a clip past the end of its video clamped, `"true"` → true, `#`
    added to hashtags, an unknown text position → top.
  - Against the job (`ctx`): input numbers must exist (clips, marks, framed, coverFrom); recipe, look, music mood
    and sticker names must be real; unknown transitions / animations become "" (the recipe's choice).
  - Every repair / drop is logged with its reason (`plan: N repaired / dropped: …`) and returned as
    `output.planIssues`.
- **Tests:** `npm run test:plan` (sloppy plan: 15 checks; both saved real Arcane plans pass with zero issues and all
  clips kept). `test-reel` now fails a case whose hand-written plan needs any repair (a broken test plan must not be
  hidden by the schema). That check found `brighten` (still read by the pipeline) missing from the schema → added.

**Not verified:** a real cheap-model plan through the schema (none exists yet; P1-5 will produce some).
The per-field checks still left inside `runReel` (e.g. `Array.isArray(plan.marks)`) are now redundant; removing them
belongs with the `runReel` split (P2-1).

### 2026-11-15 — P1-4 cinematic style fixes (offline only, 0 tokens)
- **Text:** cinematic styles 46/52/46/40 px at weight 300 → 58/64/56/48 px at 500, outline 1.2 → 1.8.
- **Backing on busy footage:** for every cinematic text and subtitle, one frame is rendered exactly as the reel will
  show it (same 9:16 layout, crop, bars, look; no text) at that text's moment, and the band where the text sits is
  measured (`bandStats`: edge density + brightness). Over 9 edges or 150 luma → a soft blurred ~70 % black band
  behind it (`backdropEvent`). Measuring the source frame instead was wrong: a landscape clip's top text sits on the
  blurred fill, not on the picture. Thresholds from fixtures: calm 2.5–7, busy 12–40 (`npm run test:style`).
- **Transitions:** cinematic was hard cuts only (and since P1-1 the model no longer picks transitions). Now about one
  join in four — the biggest jumps in the source, or a change of input — gets a soft dip / fade, alternating;
  continuous takes stay cuts. Arcane replay: 3 → 7 soft joins of 15, 1 of 4 texts backed.
- `test-reel` asserts on the Arcane replay: at least one soft transition and one text backing (`output.backdrops`).

**Not done:** "review each recipe once against one real reference reel" needs reference reels from the user
(one per recipe: quiz, list, before-after, tutorial, story, hook, promo, cinematic, talk).
**Not verified:** how the backing looks on a phone (checked only in frame grabs), and the thresholds on footage
other than the fixtures.
