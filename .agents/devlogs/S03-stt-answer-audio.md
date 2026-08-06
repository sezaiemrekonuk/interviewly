---
task: S03
author: Ahmet
sessions: [2026-08-07]
model: claude-opus-4.8
model_recommended: claude-sonnet-5
iterations: 1
tools: [verification-before-completion, repo-memory]
---

## Session 1 — 2026-08-07

Ran opus on a sonnet-tier task by explicit owner override (tier line printed, owner said
"go with opus"). No correctness gain over sonnet — this task is provider plumbing over an
existing answer path — so the switch was a preference, not a requirement.

### What I asked for / what came back
- Asked: implement S03 — `POST /interviews/:id/answers/audio`, transcribe then delegate to the
  existing guarded advance, no second answer path.
- Returned: `backend/modules/speech/stt.ts` (`uploadAudioMiddleware` + `submitAnswerAudio`),
  router mount behind `requirePublicOrigin`, `FakeSpeechProvider.transcribeEmptyNext()`,
  `VOICE_CAPABLE_STATES` exported from `tts.ts`, speech AC-3/4/6/14 + `stt.test.ts`.

### Methodology trace
- spec S03 AC-3/4/6/14 → `.agents/features/speech_turn.feature` → red (no route: 404/no handler)
- red → `stt.ts` + `router.ts` mount + fake empty-transcript mode → green
- unit AC (step 7) → `stt.test.ts` empty→`SPEECH_TRANSCRIPTION_FAILED` no advance; success→one
  `voice` answer → green (4/4)
- AC-14 audio-not-persisted proof: `fakeStorage.keys()` empty after a voice answer
- DB check: `answers` groups to `voice` (22) + `text` (218) — upload path writes `voice`

### Friction
- Acceptance needs Docker; native Postgres on `:5432` shadows the container (repo memory).
  Used the 15432/16380 compose override + explicit `DATABASE_URL`/`REDIS_URL`.
- Typecheck red on two unrelated fronts: stale Prisma client vs the `upload_filename`
  migration (`prisma generate` fixed it) and `frontend` missing `@types/fontkit` (pre-existing,
  left for the W ledger). My own error: `Buffer` is not a `BlobPart` — wrapped in `Uint8Array`.
- Honesty note: acceptance scenarios and impl were written in one pass; redness was reasoned
  from "no route mounted", not captured as a separate failing run. The unit ceiling/empty tests
  do fail if the guard is removed, so nothing here is a test that cannot fail.

### What I rejected and rewrote by hand
- Rejected using the fake's `failNext` (→ `VOICE_UNAVAILABLE`) for AC-4 "undecodable": that is
  "provider down", not "provider produced nothing". Added a distinct empty-transcript mode so
  the undecodable case maps to `SPEECH_TRANSCRIPTION_FAILED`, matching the REFERENCE error table.
- Rejected an env-config knob for the audio size cap. `uploads.ts` uses a module constant and a
  per-answer recording cap is not a decision the validated config surface needs to carry.
- Rejected doing metering here — S04 owns `withBudget` around both call sites; folding it in
  would pre-empt the opus task that exists precisely because that transaction is where money
  leaks. Left `transcribe` unwrapped and noted the `seconds` quantity S04 will bill.

## Post-review fixes (2026-08-07)

Code review confirmed three defects; all fixed test-first, suite green (20 speech unit tests,
14 @speech acceptance scenarios, 476 total unit).

- **Client-supplied `questionId`.** The handler had fabricated `questionId` from
  `currentQuestionRow`, which made `advanceWithAnswer`'s `QUESTION_NOT_CURRENT` check
  tautological — a retried upload (lost response, double-tap) would record question N's
  transcript as the answer to question N+1. The recorder now names its question in a
  `questionId` multipart field (the `fields: 1` slot); missing → `VALIDATION_ERROR`, stale →
  `QUESTION_NOT_CURRENT`, both before the provider is billed. New AC scenario asserts the
  stale case changes nothing.
- **ADR-I32 on the ceiling transition.** Both `stt.ts` and `tts.ts` called `applyTransition`
  bare in the ceiling branch, so the loser of a concurrent expiry (TTS poll + answer POST)
  surfaced 409 `INVALID_STATE_TRANSITION` instead of 403 `VOICE_SESSION_EXPIRED`. Now
  try/caught with `INTERVIEW_END_FAILED` logged, mirroring `answers.ts`. The same bare call in
  `voice/webhook-router.ts:58-63` is pre-existing and left for its own task.
- **Guards before multer.** `uploadAudioMiddleware` ran first, so any authenticated user could
  buffer 10 MiB per request against non-owned/expired ids before rejection (N concurrent =
  N x 10 MiB heap). Ownership/mode/state/ceiling moved into `guardVoiceAnswer`, mounted ahead
  of multer; a router-stack test pins the order. Residual accepted: an owner can still buffer
  against their own live interview — a rate limiter is the remaining hardening if it ever
  matters.
