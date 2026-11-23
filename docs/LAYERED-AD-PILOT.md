# GapGPT layered product-ad pilot — 2026-11-22

The user clarified that the target is a cinematic, AI-retouched product ad split
into coordinated transparent assets, rather than a moving frame of the raw
photo. They supplied `raw.png` (the original Pepsi photograph) and `result.png`
(the intended finished composition) and approved testing that workflow.

## Actual evidence

Two explicit image-edit requests were sent to GapGPT using the existing key,
model `gpt-image-2.6-sunburst`, high quality, 1024×1536, PNG and native
`background=transparent`. Both returned HTTP200 with an image URL. The provider
returned no usage breakdown, so the exact charge is unknown. No automatic retry,
model fallback, third generation, application restart or customer draft change
was performed.

Private outputs and request receipts are under
`data/test-out/layered-ad-pilot-20261122/` (ignored by Git):

- `product.png`: retouched isolated bottle. Inputs: original photo **and** the
  supplied result as composition/art-direction reference. Actual alpha decode:
  73.9332% alpha-zero pixels, nonempty content, 1024×1536.
- `splash-back.png`: independent cola ribbon/droplets. Input: supplied result.
  Actual alpha decode: 47.6927% alpha-zero pixels, nonempty content, 1024×1536.
- `product-checker.jpg` and `splash-checker.jpg`: diagnostic checkerboard
  composites, visually inspected. They are preview JPGs; originals retain alpha.
- `two-layer-preview.jpg`: layers composited at their shared canvas coordinates
  on a **plain local navy diagnostic background**, not a generated studio set.

Observed: real cutout and splash transparency, no residual room background or
product in the splash layer, plausible retouching/light direction, compositable
full-canvas assets. Branding appears recognizable, but exact source lettering,
product proportions and label fidelity are not certified; user review remains.
The splash contains both upper/lower parts despite a back-only instruction, so
automatic front/back depth assignment is **not demonstrated**.

## Capability code and limits

`src/image-assets.js` is a reusable GapGPT image-edit adapter with multipart
reference images, exclusive request receipts, no generation retry, and actual
PNG alpha decoding. A received flat image fails the transparent-layer contract;
the artifact/receipt remain for diagnosis. URL deliveries are downloaded without
forwarding credentials, after checking/pinning public IPv4 resolution and
validating each HTTPS redirect. Private files and API keys are not exposed by a
new public route. Offline mocked tests cover the request contract, alpha,
duplicate-request prevention and invalid delivery URLs.

It is **not yet wired into the live photo-motion template**. That template still
uses the earlier local composition implementation. Do not imply that selecting
it already invokes GapGPT.

This pilot uses a user-supplied finished composition as its master. The final
one-input workflow must create that master internally from the raw photo and
template art direction, then derive aligned assets from it. That initial
master-generation step, clean studio background, ice layers, foreground liquid,
shadow/reflection and coordinated final motion remain unimplemented/unverified.
Do not claim a fully layered scene or a one-photo end-to-end system is finished.
