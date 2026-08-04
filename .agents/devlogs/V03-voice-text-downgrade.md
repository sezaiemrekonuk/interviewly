---
task: V03
author: Fatih
sessions: [2026-08-04]
model: claude-opus-5
model_recommended: claude-opus-4.8
iterations: 1
tools: []
---

## Session 1 — 2026-08-04

`model` ≠ `model_recommended`: MODELS.md names `claude-opus-4.8`, the session ran `claude-opus-5`.
Same opus tier (EXECUTE.md §5 matches on tier, not build), so the run proceeded.

### What I asked for / what came back
- Read the ledger, then `voice_fallback.feature` before writing anything. The feature file is the
  spec; the task file's prose is not.
- `downgrade.ts` came back essentially as shipped. The wiring in `session.ts` did not.

### Methodology trace
spec §3.8 / ADR-V03 → `voice_fallback.feature:4` @AC-6 → added to `cucumber.js` `paths` → red
(`2 undefined, 12 undefined steps`) → `downgradeToText` + mint wiring + `voice-fallback.steps.ts`
→ green (`2 scenarios, 19 steps`). One red→green cycle; no assertion needed a second attempt.

### Friction
- **ADR-V03 specifies an impossible path.** "Routed through the I07 transition" — `applyTransition`
  takes `(interview, state, ctx)` and writes `interviews.state`; there is no `mode` parameter and
  `mode` is not a K2 edge. Read `machine.ts` before believing the ADR. Recorded ADR-V03-2 rather
  than editing ADR-V03 (append-only).
- **The mint's error code contradicted the feature file.** `session.ts` returned
  `VOICE_UNAVAILABLE` for `mode !== 'voice'`; @AC-6 demands 409 `INVALID_STATE_TRANSITION`. Checked
  `voice_session.feature` first — no scenario covered the non-voice mint, so the change was free.
- Local acceptance still needs `DATABASE_URL`/`REDIS_URL` overrides (compose hostnames in `.env`),
  and `npm install` — the merged I11 upload work added `@aws-sdk/s3-request-presigner`, uninstalled
  locally, which crashes cucumber at step-definition load before any scenario runs.

### What I rejected and rewrote by hand
- **Wrapping the whole mint handler in the downgrade try/catch.** That downgrades on a non-owner
  403 and on a kill-switch 503 — a stranger could burn someone's voice mode, and a transient
  `AI_ENABLED=false` would permanently one-way an interview. Narrowed to the `_session.mint()` call
  alone, which is the only "failed *at voice*" case the spec's failure table lists.
- **A `POST /interviews/:id/voice/downgrade` endpoint.** Not in @AC-6, not in the DoD; it is a new
  unauthenticated-by-nature client signal with no scenario behind it. V05's pre-join is where the
  spec puts mic-denied, so it ships there and calls the exported function. Scope, not laziness.
- **A read-then-write idempotency check** (`if (interview.mode === 'text') return`). Replaced with
  the `mode: 'voice'` predicate in the `updateMany` WHERE — one statement, no TOCTOU, and the same
  clause enforces the one-directional rule.
- **`this` aliased into the log-capture closure** — eslint `no-this-alias`. Rewrote as a named
  helper taking the world, matching `voice-webhook.steps.ts`.
