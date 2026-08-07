# S05 — Remove the convai, webhook and reconciliation surface; drop `voice_sessions`
REPO: (this repo) · Depends: S02, S03, S04 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — deletion across seven backend files, the worker, a queue, a
migration, four error codes, two locales and the compose file, where the risk is not what gets
deleted but what quietly goes with it. `isPastCeiling` is the only writer of `time_exhausted`;
this task must prove the ceiling still fires after its gate is gone.

## Goal
Owner's ask:

> "Webhook kullanmıyoruz."
> — the owner's decision, 2026-08-06; ADR-S01, ADR-S03, ADR-S05

Removes the Conversational-AI integration and everything that existed only to serve it: the
mint, the four webhook gates, the reconciliation job and queue, the `cloudflared` tunnel, the
four webhook error codes, and the `voice_sessions` table.

## Security boundaries
- **Deleting a trust boundary is a security change.** ADR-S03 records why the four gates go and
  why leaving the route mounted-but-unreachable is worse than removing it. Read that ADR before
  the first deletion; do not re-derive the reasoning.
- **`VOICE_SESSION_EXPIRED` is kept.** The ceiling still needs a code and this one already has
  copy in both locales. The other three webhook codes go with their producer.
- **The API key stays out of the deletion.** `ELEVENLABS_API_KEY` is now S01's, required and
  live. Only the agent ids and the webhook secret are removed.

## Non-negotiables
- **Run last among the backend tasks.** S02, S03 and S04 must be `done`. Deleting before
  replacing leaves the repo with no voice path and the acceptance ring red for a reason nobody
  can distinguish from a regression.
- **The ceiling must still fire.** `webhook-auth.ts:97` `isPastCeiling` is today the only writer
  of `ended_reason = 'time_exhausted'`. The definition of done below asserts the transition
  after the file is gone. If the assertion cannot be written, the ceiling has already been lost.
- **The `voice_sessions` drop is a new migration rebased on F02** (ADR-F02, ADR-S05). Never an
  edit to `20260730130638_init/migration.sql`.
- **Delete tests with their code, never before it.** A deleted assertion and a deleted feature
  are the same commit or neither.
- **`downgrade.ts` and `POST /:id/voice/downgrade` survive untouched.** They are V03's, they are
  correct, and S07 depends on them.

## Context (anchors)

Backend, delete: `modules/voice/{VoiceSession,elevenlabs-session,fake-session,webhook-auth,
webhook-router,reconcile-webhook,reconcile}.ts` and `webhook-auth.test.ts`;
`src/app.ts:18,20,24-29,60-63` (imports, the `/webhooks` raw-body parser, both mounts);
`src/lib/queue.ts:29,32`; `src/worker-exports.ts:11-12,17-18`;
`tests/support/harness.ts:10,78`; `src/lib/error-codes.ts:43-45`.

`modules/voice/session.ts` is **partially** deleted: `mintVoiceSession`, `voiceSeam`,
`setVoiceSession` and the `POST /:id/voice/session` route go; `preJoinDowngrade` and
`POST /:id/voice/downgrade` (`:107,116`) stay. Consider moving the survivors into
`modules/voice/downgrade.ts` so the file that remains is named for what it does.

Worker, delete: `src/jobs/voice-reconcile.ts` + its test; `src/index.ts:1,8,61-63,108-111,127,139`;
`src/lib/env.ts:29-30`.

Frontend, delete: `src/lib/voice/session.ts`; `src/test/websocket-mock.ts` (`:3` — the voice
session is its only consumer); `src/lib/use-voice-session.test.ts`; the WSS assertions in
`src/app/interviews/[id]/room/voice.test.tsx:69,70,98-100`; the four webhook error keys in
`messages/{en,tr}.json:274-277`.

Config, delete: `compose.dev.yaml:13-18` (`cloudflared`); `.env` and `.env.example`
`ELEVENLABS_AGENT_ID_HR`, `ELEVENLABS_AGENT_ID_TECH`, `ELEVENLABS_WEBHOOK_SECRET`,
`VOICE_WEBHOOK_FRESHNESS_SECONDS`; the same keys at `backend/src/lib/env.ts:40-42,45-47`.

Acceptance, delete: `.agents/features/voice_session.feature`, `voice_webhook.feature`,
`voice_reconciliation.feature`; `backend/features/step_definitions/voice-{session,webhook,
reconcile}.steps.ts`; the queue import and close at `step_definitions/server.ts:14,73,87`; the
`voiceSession.count` assertion at `step_definitions/answers.steps.ts:189`; the corresponding
`cucumber.js:82-85` paths and the `.agents/features/COVERAGE.md:114,120-134` rows.

Rename, do not delete: `voice_fallback.feature` → `speech_fallback.feature`. The downgrade
invariant survives the architecture change unchanged; only the trigger it is driven by moves
from `FakeVoiceSession` to `FakeSpeechProvider`.

## Steps
- [x] **1. Rewrite `speech_fallback.feature` first** — same assertions as `voice_fallback`,
  driven by `FakeSpeechProvider.failNext`. Green before anything is deleted, so the invariant is
  demonstrably still covered when the old file goes.
- [x] **2. Assert the ceiling** — add a `speech_turn.feature` scenario driving a past-ceiling TTS
  and a past-ceiling STT to `time_exhausted`. Green **before** `webhook-auth.ts` is touched.
- [x] **3. Backend deletion** — the file list above, in one pass, then `npm run typecheck` as the
  guide to what still references it.
- [x] **4. Worker deletion** — job, test, worker registration, shutdown, env keys.
- [x] **5. Frontend and locale deletion** — the four webhook error keys in both locales, the WSS
  test scaffolding.
- [x] **6. Config deletion** — the tunnel, the four env keys in `.env`, `.env.example` and both
  `env.ts` files.
- [x] **7. Migration** — a new migration dropping `voice_sessions`, plus the model and the
  `Interview.voice_sessions` relation at `schema.prisma:267,359-369`.
- [x] **8. Acceptance cleanup** — delete the three feature files and their step definitions;
  update `cucumber.js` paths and `COVERAGE.md` in the same pass.
- [x] **9. Full gate** — lint, typecheck, unit, acceptance. A green ring here is the only proof
  that nothing load-bearing left with the deletion.

## Definition of done
- speech AC-6 green **after** `webhook-auth.ts` no longer exists: a past-ceiling TTS or STT call
  makes no provider call and leaves `ended_reason = 'time_exhausted'`.
- speech AC-7 green: `speech_fallback.feature` proves the downgrade invariant against the new
  provider.
- speech AC-9 green: `frontend/src/middleware.ts:9` still reads `connect-src 'self'`, and grep
  for `new WebSocket` across `frontend/src` returns nothing.
- `grep -rn "webhook" backend worker --include="*.ts"` returns nothing outside `dist/`.
- `docker compose config` no longer lists a `tunnel` service.
- `npm run test:acceptance` green with three fewer feature files and no skipped scenarios.

## Verification
```bash
npm run lint && npm run typecheck && npm test
npm run test:acceptance
grep -rn "webhook\|voiceSession\|convai\|wssOrigin" backend worker frontend/src --include="*.ts" --include="*.tsx" | grep -v dist
psql "$DATABASE_URL" -c "\dt voice_sessions"
```
Expected: all gates green; the grep prints nothing; `\dt` reports no such relation.

## Notes

**The ceiling never depended on `webhook-auth.ts`.** S02 put `isPastSpeechCeiling` in
`modules/speech/tts.ts`; `stt.ts` imports it. Deleting `isPastCeiling` removed a second copy,
not the enforcement. `speech_turn.feature` @AC-6 (TTS + STT) was green before the deletion and
after it.

**Three things the file list did not name but the DoD required:**
- `frontend/src/middleware.ts:9` still carried `connect-src 'self' wss://api.elevenlabs.io`.
  Narrowed to `'self'` — a CSP allowance for a dial nobody makes.
- `use-voice-session.ts` was not on the delete list but held the `new WebSocket` the DoD
  forbids. Rewritten as a mic-only hook keeping its exported surface
  (`VoiceConnectionStatus`, `UseVoiceSessionResult`, `reconnect`) so `room/page.tsx`,
  `room-rail.tsx` and `voice-controls.tsx` still compile. **`status` now derives from the mic**
  (`granted`→connected, `denied`/`unavailable`→lost, else connecting) and `beat` is always
  `null`. **S06 owns both**: it drives `beat` from the turn loop and decides whether status
  should mean anything richer.
- `src/test/websocket-mock.ts` could not just be deleted — `installMediaDevicesMock` lives in
  it and `voice.test.tsx` needs it. Renamed `media-devices-mock.ts`, WebSocket half removed.

**Coverage deliberately dropped, not forgotten:** `voice.test.tsx`'s
"offers a reconnect on a dropped session" went with the socket it dropped. Nothing now produces
`status: 'lost'` in a test. **S07** (mic-denied) is the natural place to re-cover it.

`a {string} event is emitted with the interviewId` moved from the deleted `voice-webhook.steps`
into `speech-fallback.steps` — one global step registry, so nothing else had to change.

`preJoinDowngrade` + `POST /:id/voice/downgrade` moved from `session.ts` into `downgrade.ts`,
which is now the entire `modules/voice/` directory. V03's `downgradeToText` is untouched.

Also deleted, beyond the file list: `elevenlabs/conversational` in `model-prices.yaml` (S04
kept it alive for voice-reconcile), the worker's `ELEVENLABS_API_KEY` (its only consumer was
`reconcile.ts`), and `answers.steps.ts`'s `voiceSession.count` assertion.

**Stale after this task, not fixed here:** `.agents/specs/2026-07-29-voice.md` and
`.agents/docs/IDEA.md` still describe the webhook architecture. They are the historical record
(ADR-S01 supersedes by reference, never by edit). `.agents/EXECUTE.md`'s "voice does not work
on localhost without the tunnel" WAS fixed — it is an instruction, not a record.
