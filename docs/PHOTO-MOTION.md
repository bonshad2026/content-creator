# Photo composition and the single-photo experimental template

> **Template version3 / creative protocol3 — current:** new preview jobs now set
> `templateData.creativeProtocol=3`, retaining `adVersion=2` as the artifact/runtime
> format for compatibility. Do NOT bump the artifact version to switch creative
> behavior. Existing v2 retries keep their original cached direction/prompt and
> drift renderer; new previews/revisions use the new policy and choreography.
>
> `src/ad-grounding.js` defines a product-independent observation/evidence
> contract. One raw-photo observation step distinguishes real objects, printed
> graphics, legible ingredients, branding, material and visible moisture. Accents
> must cite observation IDs or an actual quoted user request. A printed graphic
> cannot justify a physical prop; source material/ingredient text cannot justify
> changing the product's surface. Missing/invalid support omits an accent before
> image generation. A separate semantic direction review judges viewer-facing
> associations. Unaccepted props are omitted, free-form whole-scene descriptions
> cannot reintroduce them, and rejected directions get a neutral empty studio.
> Final visual QC also requires semanticallyAppropriate, beyond geometry/branding.
> These checks reduce risk; they do not prove model perception is infallible.
>
> Production `animateAdLayers` now dispatches motionProfile=hero-reveal-v2 to
> `src/ad-motion.js`: product detail hook, eased 2D entrance/pullback, staggered
> rear/front assembly, hero push, and a final hold. It writes motion.json, limits
> output size, preserves alpha until compositing and uses no intrinsic fluid/body
> animation, new camera angles, lid opening or hand interaction. Subject/frame
> transforms and crop are shared across arbitrary products; no category branches
> or fixed accessory list. Previously generated graphics are reused for motion.
>
> Verification:129 UI/core,10 grounded end-to-end synthetic checks,26 private photo
> API/real synthetic render checks,20 legacy ad checks,95 video-template checks,
> 10 retention checks and typecheck/build pass. Pixel checks demonstrate a visible
> opening and stable nonblack final hold. An actual preexisting MY design was
> COPIED into an isolated folder and reused with zero provider requests to check
> backward compatibility; originals were unchanged. No paid generation, inference
> on a new product, or rerender of a user job was performed. The next user-provided
> different product is the real creative/semantic evaluation.

> **Current implementation — 2026-11-22, version2:** the historical local-only
> implementation below is superseded for new previews. `src/ad-scene.js` now
> handles raw-photo vision direction, internally generated master, independent
> alpha layers, semantic review and six-second layered rendering. There are no
> product-category branches. A template bounds style/canvas/motion; the planner
> chooses suitable accents (up to4, with arbitrary stable IDs and explicit depth).
> User flow: upload one image → build complete motion preview → comment/revise →
> explicitly approve the final video. Masters and layers are internal and are
> never separately presented for user approval. Unknown identity pauses for one
> question before image generation. Source labels/geometry are explicit
> invariants, with a visual review gate; this is not proof of perfect fidelity.
>
> Previews use owner-authenticated range-streaming under `/api/edits`; `/media`
> refuses unapproved preview jobs. The draft remains active, and preview jobs
> stay outside finished history, until explicit approval. Text feedback creates
> a separate preview with its parent retained. Approved output can reopen for
> revision only without displacing another active draft. Native-alpha assets,
> model JSON steps, hashes and request receipts are private. Completed steps
> resume from cache. Ambiguous/interrupted provider requests cannot automatically
> repeat in the same attempt; explicit retry changes the attempt ID and
> regenerates only rejected/missing assets. Motion-only feedback can reuse the
> master, images and visual review; bounded strength/speed are .5–1.5.
>
> GapGPT image model is separately configurable via `GAPGPT_IMAGE_MODEL`, default
> `gpt-image-2.6-sunburst`. No silent local-only fallback. Actual token/cost data
> are recorded when supplied; missing cost is marked unpriced. A new preview can
> require a direction request, one master,2–7 layer images and a visual-review
> request. Refresh does not start paid work. Raw/generated assets of the latest
> active draft are retained; finished job sources/layers follow raw retention.
>
> Verification: `test:ad`18 synthetic/mocked checks, `test:photo`25 API/real-render
> checks,116 UI/core tests,95 existing template checks,10 retention checks and
> TypeScript checks. Five named product categories are *contract fixtures*, not
> five live vision evaluations. Current work made zero new paid calls. The earlier
> two-image Pepsi pilot proves the GapGPT edit/URL/alpha path only; one-photo
> end-to-end creative quality and cross-product model comprehension remain
> unverified with live inference. See `docs/LAYERED-AD-PILOT.md` for that boundary.

`photo-motion` accepts exactly one still JPEG, PNG or WebP (25 MiB maximum), then
exports a silent six-second 720×1280 H.264 MP4. The template card has an actual
playable synthetic sample, rebuilt locally if missing during the UI build.

This is the first **local composition** implementation, not a generative image
editing integration. It preserves the photograph inside a moving frame, makes a
blurred photographic background and a transparent orbital graphic layer, and
animates their positions/scale separately. It does not segment the photographed
product, reconstruct hidden surfaces, generate a new photographic environment,
or animate the product itself. No claim of these capabilities should appear in
the UI or AI capability contract. The synthetic render establishes technical
execution; photographic/editorial quality with the user's real photo and mobile
usability still need user review.

## Capability boundary

`src/photo-motion.js` exports `preparePhoto`, `composePhotoLayers`, `photoScene`
and `renderPhotoScene`. Composition is independent of speech analysis and the
product-presenter template. Other renderers can consume the layer PNGs and the
versioned scene manifest without making an MP4. Scene layers are background,
transparent decoration, and the original photo in its frame; `segmented:false`
explicitly records their provenance. A future provider adapter for actual image
editing/segmentation needs its own verified reference-photo contract and tests;
none is wired in here.

`src/photo-edit.js` adapts that capability to persistent edits and the existing
server-side job queue. There is still only one active draft per account across
both templates. Choosing a new template returns an existing active draft rather
than erasing it. Photo drafts bypass the speech/conversation model entirely.
Generic transcript, analysis, confirmation and revision actions are rejected for
this experimental template; it does not advertise revision support.

## Data and execution

- Original selection stays in IndexedDB until acknowledgment. Failed uploads
  preserve it; the existing chunk transport supports resumable sending.
- A normalized PNG is stored privately as `<asset-id>.media` after inspecting
  actual format/dimensions and decoding with bounded pixel count/time.
- Only owner-authenticated `/api/edits/:id/photo` serves the input preview.
  The media cookie uses the existing private edit scope. Preview URLs include
  the asset ID so replacing a photo refreshes the displayed image.
- Repeating a completed attach or Build request returns its existing result.
  No provider requests or token accounting are involved. Existing reel plan
  eligibility still applies to uploads/builds; no new billing plan was added.
- Rendering continues on the server after navigation. Output checks cover
  dimensions, duration and the 5 MiB size ceiling. CRF22, bounded bitrate and
  faststart keep exports small. The image original is retained separately from
  generated layers/cover; existing raw retention removes normalized sources.
- `scene.json` and layer PNGs remain private in the job directory. Only the MP4
  and cover use existing finished-output routes.

## Offline checks

`npm run test:photo` runs actual synthetic image decoding/export and API checks:
shared draft exclusivity, unauthorized access, invalid content, explicit Build,
attach/build idempotence, no entry into speech analysis, real stage callbacks,
six-second silent 720p output under 5 MiB, independent saved layers, and different
decoded frames at seconds 1/3/5. React tests cover local recovery, replacement
persistence, failed-send retention, acknowledgment before Build and cancellation
confirmation. No real user image or paid API call is used by these checks.
