---
task: I15
author: Sezai
sessions: [2026-08-04]
model: claude-sonnet-4.6
model_recommended: claude-sonnet-4.6
iterations: 3
tools: [superpowers:test-driven-development, cavecrew-investigator]
---

## Session 1 — 2026-08-04

### What I asked for / what came back
- Asked: wire `config.feature` @AC-5, extend the F03 env schema. Expected a mechanical Zod diff.
- Came back: the schema was already complete except `REDIS_URL: z.string()`. The task's real
  content turned out to be the test harness and the bug it exposed.

### Methodology trace
- feature added to `cucumber.js` default paths → red (undefined steps) before any step file.
- steps written → red for the right reason: `S3_BUCKET` unset **served anyway**.
- root cause: `@prisma/client` loads repo-root `.env` into `process.env` on import, and
  `index.ts` imported `../modules/ai` before `./lib/env` → validator saw a backfilled env.
- fix: `./lib/env` first import (ADR-I37) + `REDIS_URL.url()` → green 4/4, 40 steps.

### Friction
- Three step texts (`the API starts`, `startup fails before serving`, `the boot error code is`)
  already existed in `ai-provider.steps.ts` for I02's in-process boot. cucumber allows one
  definition per text → ambiguous-step failure. Branched on `envBoot.active` instead.
- First green run *hung after printing its summary*: `node node_modules/.bin/tsx x.ts` leaves
  the server in a grandchild, so killing the child left it listening with its pipes open.
  Cost ~10 min of "is the suite slow or stuck". Fixed with `detached: true` + group kill.
- Local acceptance needs host ports (`:6380` for redis) and the auth profile refuses any DB
  not named `*_test` — pre-existing guard, not this task's.

### What I rejected and rewrote by hand
- First draft put the colliding steps in `config.steps.ts` and duplicated the helpers there.
  Deleted: moved the boot helper to `features/fixtures/env-boot.ts` so neither step file owns
  the other's ring.
- Rejected the cheap way out of the Prisma `.env` leak — spawning the child with `cwd` pointed
  at a temp dir so Prisma finds no `.env`. It would have made the test pass while leaving the
  fail-fast guarantee as weak as it was. Fixed the import order instead.
- Rejected a second env validator for this ledger's keys (the task file's explicit trap).
