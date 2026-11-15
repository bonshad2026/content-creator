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
| `src/recipes.js` | 80 | 9 editing recipes (rules in code, the AI names one). |
| `src/vision.js` | 74 | Local face tracking (face-api on TF.js WASM). |
| `src/jobs.js`, `server.js` | | Queue, API, brand kit, feedback, revise. |
| `public/app.js` | 658 | Single-page app. |
| `scripts/test-reel.mjs` | 428 | Offline tests: hand-written plans, 0 tokens. |

Commands: `npm start` (app), `npm run demo` (port 3010, demo AI, separate data), `npm run test:reel` (17 offline cases).
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

### A. Sound is damaged on footage that is not a person talking (P0)
- **Symptom:** Arcane run 2 sounded "de-noised" although the source was clean.
- **Cause (from the code, not from listening):** Whisper returned 4 junk lines. Any surviving line sets
  `inp.hasSpeech = true`. That one flag then does three things:
  1. `voice: true` → high-pass, `afftdn`, de-esser, compressor and two EQ bands on the **whole film mix** (`media.js:604`).
  2. `duck: true` → the added music is side-chain compressed by the film audio, which is loud all the time (`media.js:668`).
  3. `bg: false` → the film audio plays at full volume against the added music (`reel.js:621`).
- **Also suspect:** single-pass `loudnorm` (dynamic mode) can pump on music.

### B. "Has speech" is decided by Whisper junk (P0)
- On music, fights and noise Whisper invents text. Two filters exist (hint echo, looped phrase); a third kind
  (mixed-language nonsense) passed.
- The Persian hint words passed as Whisper's `prompt` likely bias language detection to Persian on English audio.

### C. Token cost is not controlled (P1)
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

### G. No version control (P0, do first)
- The project is not a git repository. Every change so far is unrecoverable if something breaks.

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
