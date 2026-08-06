# Voice — State

Last updated: 2026-08-04
Last session ended: **V05 done.** `device-check.ts` + `active-speaker.ts` frontend modules created with
`release()` hygiene. `POST /interviews/:id/voice/downgrade` backend endpoint added (reuses V03's
`downgradeToText`). Frontend `session.ts` + `downgrade.ts` wrappers added. AC-11 Cucumber scenario
added to `voice_session.feature`. ElevenLabs audio surface (§15.1 item 3) unresolved — `active-speaker.ts`
falls back to 120 ms event-timer and accepts an `AudioNode | MediaStream` when the SDK spike resolves it.
Root `tsconfig.json` gained `@/*` alias for the frontend voice modules. 9/9 vitest, lint + typecheck clean.
Cucumber acceptance skipped (Docker not available in sandbox).
Next: **Voice ledger complete, and superseded (2026-08-06).** The owner reversed this ledger's
architecture: ElevenLabs is used for voice generation only — no Conversational-AI agent, no
tools, no webhooks, no tunnel. Replacement work is `.agents/ledgers/speech/` (`S01`–`S10`,
ADR-S01/S03/S04 supersede ADR-V01/V02/V04 by reference, never by edit). V01–V05 stay `done`;
they were done. **Do not start a new `V` task.** What survives in code: `downgrade.ts`, the
`POST /:id/voice/downgrade` route, and `frontend/src/lib/voice/{device-check,active-speaker,
downgrade}.ts`. D03 is the next eligible Fatih task.

## Execution protocol (follow exactly)

Do not start from this file. `.agents/EXECUTE.md` is the prompt, and its § 4 decides which
task is yours — not the "Current task" pointer below, which is a human-readable summary and
can lag.

Read this file → read `REFERENCE.md` once → read only the task § 4 gave you →
check `MODELS.md` for the required tier and stop if it is not yours → do the work, ticking
checkboxes → run the task's `## Verification` command verbatim → fill in the task's
`## Notes` → update this file's ledger row, "Current task" pointer, and "Last session ended"
line → write `.agents/devlogs/{ID}-<slug>.md` (EXECUTE.md § Devlog) → **do not commit** →
re-apply EXECUTE.md § 4 and continue with what it gives you.

## Current task

**V05** (pre-join device check + active-speaker signal) is next and last in this ledger: `todo`, deps V01/V03 both `done`. A denied microphone calls V03's exported `downgradeToText` — it does not mint. Append `voice_session.feature`'s pre-join scenarios (or its own file) to `cucumber.js` `paths` the way V04 appended `voice_reconciliation.feature`.

## Environment

Voice tasks require foundations, auth and their interview-core dependencies to be `done` first
(per each task's `Depends on`):

- **F01** provides `backend/src/lib/error-codes.ts` (the voice codes below) and `@interviewly/types`.
- **F02** provides `backend/prisma/schema.prisma` (`voice_sessions`, `answers.input_mode`,
  `llm_calls`, `interviews.mode`/`spent_usd`/`ended_reason`) and `backend/src/lib/db.ts`.
- **F03** provides `backend/src/lib/logger.ts`, `backend/src/lib/env.ts` (the `ELEVENLABS_*`,
  `VOICE_MAX_ROUND_SECONDS`, `VOICE_MAX_INTERVIEW_SECONDS`, `AI_ENABLED` keys), `compose.yaml`
  (Postgres + Redis), the CI acceptance runner, and the `worker/` scaffold (`worker/src/lib/*`).
- **A01** provides `requireAuth`, `backend/src/app.ts` (router mount + global error handler +
  traceId), and the Redis client.
- **I03** provides the ownership resolver and `GET /state` room-state (the mint reads the interview's
  state and owner).
- **I06** provides `POST /interviews/:id/answers` (the guarded advance the webhook's `submit_answer`
  reuses to persist a voice answer).
- **I07** provides `backend/modules/interview/machine.ts` (`applyTransition`, the sole writer of
  `interviews.state`; the downgrade and `time_exhausted` transitions route here).
- **I08** provides `backend/modules/interview/budget.ts` and the `spent_usd` + `llm_calls`
  single-transaction contract the reconciliation reuses.

Set up the environment once the dependencies land:

```bash
docker compose up -d db cache
cd backend && npm install && npx prisma migrate deploy && npm run seed
```

Voice mode over a live provider additionally needs the `cloudflared` tunnel wired into
`PUBLIC_ORIGIN` (§3.5, `infra`) — **not required for the acceptance ring**, which drives
`FakeVoiceSession` and posts webhooks in-process. Confirm the Cucumber runner is wired (F03/CI)
before running any Verification command.

## Open blockers / decisions for the user

Surfaced from the voice spec's Open questions — genuinely undecided cross-team forks. **None
blocks the four in-ring tasks** (V01–V04); each affects only the out-of-acceptance-ring frontend
surface or an env-key list. Recorded here so no session invents a resolution:

- **CSP `connect-src` — the exact ElevenLabs WSS origin (spec Open question 3, §7.4).** The edge
  must allow one extra origin for the direct browser connection; the concrete value is whatever the
  SDK actually dials. **Decides:** `voice` supplies the value (read from the mint's `wssOrigin`);
  `infra` parameterises the edge CSP to accept it (its Open question 3/4). **Blocks:** only the live
  voice-room connection (out-of-ring AC-9) — the text-mode CSP stays `default-src 'self'`. Not V01–V04.
- **ElevenLabs web SDK audio surface → `AmplitudeAvatarDriver` existence (spec Open question 2,
  §3.6).** Whether the SDK exposes a `MediaStream`/`AudioNode` for the agent's TTS output.
  **Decides:** `voice`, by an SDK spike before the frontend driver is built. **Blocks:** only whether
  the amplitude driver ships — the `EventAvatarDriver` serves both modes if it does not, so the room,
  the avatar and its score are unaffected. Not V01–V04.

Agent provisioning (spec OQ1) and session-token TTL vs the ceilings (spec OQ4) carry the spec's
recommended defaults (console-created agent ids pasted into `.env`; mint to the tighter ceiling and
rely on the server-side webhook re-check) and do not block V01 — adopt those defaults unless the
owner changes them.

## Task ledger (V01–V04)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo (backend/worker are workspaces in it). Dependency-sorted.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| V01 | `VoiceSession` seam, `FakeVoiceSession`, and the session-mint endpoint | | done | F01, F02, F03, A01, I03, I07 |
| V02 | ElevenLabs webhook authentication: the four gates + submit_answer/next_question/end_round + log redaction | | done | V01, I06, I07 |
| V03 | Voice → text downgrade on a fatal voice failure | | done | V01, I06, I07 |
| V04 | Post-call usage reconciliation worker job (idempotent `spent_usd` + `llm_calls` transaction) | | done | V02, I08 |
| V05 | Pre-join device check + active-speaker signal for the two persona tiles | | done | V01, V03 |

**V02 and V03 are genuinely independent** — both depend on V01, I06 and I07 but not on each other;
either order is safe for the single ledger owner. V04 depends on V02 (it reuses V02's HMAC +
freshness signature verifier).

**V05 (added 2026-07-30)** covers the two surfaces the §3.2 room revision adds: the `/interviews/:id/
pre-join` device check — which must run **before** a session is minted, so a denied microphone
downgrades to text without spending a token — and the amplitude/event signal that drives the
active-speaker ring on the round's persona tile. It depends on V03 because a denied permission uses
V03's downgrade path rather than a second one. `frontend` owns the screens; V05 owns what they test
and the signal they render.

## Critical path

F01/F02/F03 + A01 + I03/I06/I07/I08 (all interview-core deps green) → **V01 → V02 → V04**. V03
branches off V01 (parallel with V02). This is the whole voice slice; nothing downstream waits on it.

## Cross-ledger dependencies (blocks this ledger)

| Ledger task | Provides | Needed by |
|---|---|---|
| F01 | `error-codes.ts` registry (`WEBHOOK_SIGNATURE_INVALID`, `WEBHOOK_REPLAY_REJECTED`, `VOICE_SESSION_INVALID`, `VOICE_SESSION_EXPIRED`, `VOICE_UNAVAILABLE`, and the consumed `INVALID_STATE_TRANSITION`, `FORBIDDEN`, `UNAUTHENTICATED`, `INTERVIEW_NOT_FOUND`, `VALIDATION_ERROR`), `@interviewly/types` | V01–V04 |
| F02 | `schema.prisma` (`voice_sessions`, `answers.input_mode`, `llm_calls`, `interviews.mode`/`spent_usd`/`ended_reason`); `db.ts` | V01–V04 |
| F03 | `logger.ts`, `env.ts` (`ELEVENLABS_*`, `VOICE_MAX_*`, `AI_ENABLED`), `compose.yaml`, CI runner, `worker/` scaffold | V01–V04 |
| A01 | `requireAuth`, `app.ts` router mount, global error handler + traceId, Redis client | V01, V02, V04 |
| I03 | Ownership resolver + `GET /state` room-state (mint reads owner + voice-capable state) | V01 |
| I06 | `POST /answers` guarded advance (webhook `submit_answer` persists a voice answer through it) | V02, V03 |
| I07 | `machine.ts` `applyTransition` (downgrade + `time_exhausted` route here; mint legality) | V01, V02, V03 |
| I08 | `budget.ts` + the `spent_usd`/`llm_calls` single-transaction contract | V04 |

**No voice task may be merged until its `Depends on` are green.** A partial state — e.g. I07 done
but I06 not — means the webhook's `submit_answer` has no guarded-advance path to call.

## Cross-ledger dependencies (this ledger blocks)

**None.** Voice is authored last (§12, AUTHOR_DOCS "write it last; do not let it block anything").
No other ledger cites a `V0x` task in its `Depends on`. Record no ledger as depending on voice.

## ⚠ Known tech debt

- **[V02] Double `currentQuestionRow` query on `submit_answer`** — webhook handler fetches
  the row to obtain `question.id`, then `advanceWithAnswer` fetches it again internally
  (its own `QUESTION_NOT_CURRENT` guard). 2× round+question queries per webhook answer.
  Not a correctness issue; fix requires `advanceWithAnswer` to accept a pre-fetched row.
  Promote to a task when D03 or the next `answers.ts` touch lands.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **Extract the cucumber `logger.info/warn` capture helper — TRIGGER FIRED (V04).** Four copies now:
  `report-run.steps.ts` (`captureWarnings`), `voice-webhook.steps.ts` (`captureLogs`),
  `voice-fallback.steps.ts` (`captureInfo`), `voice-reconcile.steps.ts` (`captureLogs`). Each
  patches the pino singleton and restores it in a tagged `After`. V04 stayed in scope and copied it;
  promote to one shared helper as its own task.

- **Voice room surface + avatar drivers (frontend, out-of-ring)** — the ASR transcript panel,
  mic-level bar, self-camera tile (AC-8), the direct WSS connection (AC-9), and the
  `AmplitudeAvatarDriver`/`EventAvatarDriver` voice wiring (§3.2, §3.6). Out of the Cucumber
  acceptance ring; promote as a `frontend`-owned task with a Playwright smoke once the SDK
  audio-surface spike (Open blockers) resolves.
- **ElevenLabs usage-id dedup column** — reconciliation idempotency currently uses an existence
  check on `(interview_id, provider='elevenlabs')`. If a future need to distinguish multiple voice
  segments per interview arises, promote a **nullable** `llm_calls` column in its own migration
  rebased on F02 — never an edit to the F02 migration.
- **Session-token refresh round-trip** — if the SDK spike (spec OQ4) shows the provider token TTL is
  shorter than a 12-minute round, promote a mid-round refresh. The server-side webhook re-check
  (V02 gate 4) is the true ceiling enforcement regardless.
