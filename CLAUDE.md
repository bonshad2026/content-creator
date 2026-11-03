# Content Creator (استودیو محتوا) — working notes

AI content tool for social-media creators: photo create/edit, short-video editing, effects.
Persian-first (RTL) UI with English. Reply to the owner in Persian. Persian guide: `docs/HANDOFF.fa.md`.
Separate project from Smart Store Sync and site-builder — never mix them.

## Stack & layout (npm workspaces)
- `packages/core` (`@cc/core`): all logic, TypeScript source consumed directly (no build step).
  - `config.ts` loads the root `.env` (process env wins). `db.ts` applies `schema.ts` (idempotent SQL, append new
    versions at the end) once per process under an advisory lock.
  - `storage.ts`: local-disk driver under `STORAGE_DIR`; keys are `uploads|outputs/<uuid>.<ext>` and nothing else.
  - `assets.ts`: format detected from bytes (sharp), never from the client. `jobs.ts`: create/get/run; the `jobs` row
    is the source of truth, the BullMQ entry (`queue.ts`) only says "run it". `runJob` is idempotent.
  - `tools/`: registry of job tools (zod params + `run(buffer, params)`). Today: `resize` (presets × cover/contain/blur).
    AI tools get added here behind the same interface.
  - `presets.ts` is client-safe (imported by the UI as `@cc/core/presets`); keep Node-only imports out of it.
- `apps/worker`: BullMQ worker running `runJob`. `apps/web`: Next.js 16 app router; API routes are thin wrappers.
- UI strings: Persian text is the key, `tr("…")` from `lib/i18n.tsx`, English in `lib/i18n.en.ts`.
  Server error messages are Persian and also listed there.

## Run (Windows dev machine)
- `docker compose up -d` → Postgres on **5433**, Redis on **6380** (other local projects use the default ports).
- `cp .env.example .env`, `npm install`, `npm run dev` → web on http://localhost:3100 + worker.
- `npm run typecheck && npm test` (Vitest, real Postgres `content_creator_test`, recreated per run). `npm run build`.
- CI: `.github/workflows/ci.yml` (typecheck, tests, build). Flow: feature branch → PR → CI green → merge.

## Gotchas
- `gh` is not installed: PRs in the browser pane. `git push` needs the interactive credential prompt → Terminal tab.
- sharp 0.35 types: use `ReturnType<typeof sharp>`, not `sharp.Sharp`.
- No auth yet: every upload/job is public by UUID. Add accounts before deploying anywhere.

## Next
Accounts + credits, AI tools (background removal, generate/edit by prompt, upscale) via a provider adapter
(fal.ai / Replicate), S3 storage driver, then short-video tools with ffmpeg (trim, 9:16, auto subtitles).
