---
task: I05
author: Sezai
sessions: [2026-07-31]
model: claude-opus-5
model_recommended: claude-opus-4.8
iterations: 1
tools: [superpowers:brainstorming, superpowers:test-driven-development]
---

## Session 1 — 2026-07-31

`model` ≠ `model_recommended`: MODELS.md predates Opus 5. Both are opus-tier, which is what
EXECUTE.md § 5 gates on, so the run proceeded rather than stopping.

### What I asked for / what came back
- Task framed I05 as "largely an assertion task over routes that exist" (STATE.md pointer).
  It was not — the audit steps 1–3 failed on two counts, both fixed here.
- Per-route `requirePublicOrigin` violated the file's own "no route-by-route drift"
  non-negotiable. Obvious once read; the task text and the STATE pointer both implied clean.
- The real find: **Express runs `router.param` callbacks before route middleware.** So a
  cross-site POST reached `ownership.ts` → `activeInterview()`'s DB read before the 403.
  Task step 3 asks exactly this ("check precedes the ownership resolver's side effects") and
  it was false. Not visible from reading `router.ts` top-to-bottom — `param` is declared
  above the routes but fires *inside* their dispatch.

### Methodology trace
task step 1/3 audit → both fail → `csrf.test.ts` red on the GET exemption
(`GET /:id/state` with no Origin → 403, so the guard could not be mounted router-wide) →
`SAFE_METHODS` + single `router.use` above `router.param` → 7 green →
`interview_flow.feature` @AC-15 wired → 1 scenario / 8 steps green.
1 red→green cycle: one composition change fixed both defects.

### Friction
- **Honest gap in the red:** the reject-before-resolver assertion was green on first run,
  because the mini app in `csrf.test.ts` is built in the target composition. It pins the
  rule, it did not discover it — the audit did. The GET case is the genuine red.
- `interview_flow.feature` is owned by four tasks and `cucumber.js` `paths` is file-level.
  Brainstormed with the owner rather than picking: I03's precedent (ADR-I15 + its devlog)
  is "document the undefined gap, don't hide it", but I03's gap was one task wide and this
  one spans I06+I07+I08 — a blocking CI job red on everyone's PRs for three tasks. Owner
  chose the `@unwired` skip-tag; recorded as ADR-I25 with the supersession scoped to
  multi-owner files only.

### What I rejected and rewrote by hand
- **Asserting the router's layer stack** (`router.stack` inspection) as the drift test.
  Written, then deleted: with a router-level `use` the guard is not in the route's stack at
  all, so the assertion shape differs before and after — a test coupled to the
  implementation it is supposed to constrain, and green for the wrong reason.
- **Importing the real `router.ts` into vitest** for the ordering test. Drags in
  `requireAuth`, Prisma and Redis singletons for a composition assertion; the acceptance
  suite already drives the real router over HTTP. Mini app mirroring the composition instead,
  with the reason written into the file header so the next reader does not "fix" it.
- **Exempting only `GET`** as the ledger text literally says ("every non-`GET`"). Widened to
  `GET`/`HEAD`/`OPTIONS` by hand: HEAD routes to the GET handler and OPTIONS is answered by
  the router, so neither reaches a state-changing handler, and a HEAD that 403s is a bug
  someone debugs at 3am. Noted in the `SAFE_METHODS` comment.
