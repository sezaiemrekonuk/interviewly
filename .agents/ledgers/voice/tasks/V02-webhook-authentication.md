# V02 — ElevenLabs webhook authentication: the four gates + actions + log redaction
REPO: (this repo) · Depends: V01, I06, I07 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — this is the project's new trust boundary. HMAC signature, freshness/timestamp window, nonce replay defence and legality+expiry, plus secret redaction; a gate-ordering slip, a non-constant-time compare, or a state mutation on a failing gate is a forged-webhook hole invisible to a green happy-path test.

## Goal
Owner's ask:

> "`/webhooks/elevenlabs/:action` for `submit_answer` / `next_question` / `end_round`, server-to-
> server with no cookie. Every webhook passes four gates in order — HMAC-SHA256 over the raw body,
> timestamp freshness, `(interviewId, nonce)` against an unexpired unconsumed `voice_sessions`
> row, then legal-K2-transition + wall-clock expiry — and mutates nothing on any failure. A valid
> `submit_answer` persists a voice answer through the I06 guarded advance; a webhook after the
> ceiling ends the interview `time_exhausted`. Log lines carry `interviewId` but never a secret or
> transcript. Scenarios in `voice_webhook.feature` green."
> — voice ledger decomposition (§3.5, §7.1 item 4, K6, ADR-V02)

This task creates the webhook authentication (`webhook-auth.ts`) and the action router
(`webhook-router.ts`). It **consumes** I06's guarded advance to persist a voice answer and I07's
`applyTransition` for the `time_exhausted` end — it reimplements neither. It does **not** implement
the downgrade (V03) or the post-call reconciliation (V04, which reuses this task's signature
verifier).

## Security boundaries
- **The four gates run in order, short-circuiting, mutating nothing on failure** (ADR-V02): (1)
  HMAC-SHA256 over the **raw** body against `ELEVENLABS_WEBHOOK_SECRET`, **constant-time** compare
  → `WEBHOOK_SIGNATURE_INVALID` (401); (2) `X-ElevenLabs-Timestamp` inside the window →
  `WEBHOOK_REPLAY_REJECTED` (401); (3) `(interviewId, nonce)` matches an **unexpired, unconsumed**
  `voice_sessions` row → `VOICE_SESSION_INVALID` (403); (4) legal K2 transition (I07) and ceiling
  not passed → illegal `INVALID_STATE_TRANSITION` (409), ceiling passed `VOICE_SESSION_EXPIRED`
  (403) + `time_exhausted`.
- **The raw request body must be captured before JSON parsing** for the HMAC — a re-serialised
  body will not match the signature. Verify against the exact bytes ElevenLabs signed.
- **No `nonce`, session token, API key, or transcript text in any log line** (K6, §7.2).
  `VOICE_WEBHOOK_RECEIVED` logs `interviewId` + `action`; each rejection logs its code +
  `interviewId`. `voice_webhook.feature` @AC-10 asserts, via the `LogSink` seam, that a transcript
  string and the nonce never appear in any captured field.
- **A voice tool-call holds no authority a schema/state check does not grant** (§7.1 item 4). `end_round`
  is accepted **only** when the round's questions are exhausted or an explicit shortening decision
  exists — otherwise `INVALID_STATE_TRANSITION`.

## Context (anchors)
- `backend/modules/voice/webhook-auth.ts` — **create.** Exports `verifySignature(rawBody, header)`
  (constant-time HMAC-SHA256), `checkFreshness(timestampHeader)`, `authorizeSession(interviewId,
  nonce)` (unexpired + unconsumed `voice_sessions` lookup), and a `runGates(req)` orchestrator that
  runs 1→4 and returns either the authorised session context or a typed rejection carrying the
  code + HTTP status. **This module is reused by V04** for the post-call webhook (gates 1–2 only) —
  export the individual verifiers, not just `runGates`.
- `backend/modules/voice/webhook-router.ts` — **create.** `POST /webhooks/elevenlabs/:action`,
  `action ∈ { submit_answer, next_question, end_round }`. Mounted **without** `requireAuth` (no
  cookie) and **without** CSRF (server-to-server) — the gates are the auth. On pass, dispatch:
  - `submit_answer` → call the **I06 guarded advance** to persist an `answers` row with
    `input_mode = 'voice'` and advance the K2 clock; return `200`.
  - `next_question` → deliver the next question (K2 `current_index++` via the I06/I07 path);
    `200`.
  - `end_round` → close the round **only** when exhausted/shortened, via I07 `applyTransition`;
    else `409 INVALID_STATE_TRANSITION`.
  Log `VOICE_WEBHOOK_RECEIVED` with `{ traceId, interviewId, action }` on entry (after gate 1
  passes, before the mutation).
- `backend/modules/interview/answers.ts` — I06. **Consume** the guarded advance to persist the
  voice answer; do not duplicate the `updateMany` guard or the `duration_ms` logic. Pass
  `inputMode: 'voice'`.
- `backend/modules/interview/machine.ts` — I07. `applyTransition` is the sole writer of
  `interviews.state`. Gate 4's `time_exhausted` end calls `applyTransition(→ evaluating)` and sets
  `ended_reason = 'time_exhausted'`; log `VOICE_TIME_EXHAUSTED`. Do not write `state` directly.
- `backend/modules/voice/session.ts` — V01. The `voice_sessions` row + `nonce` gate 3 authorises
  against; mark `consumed_at` when a session ends (`end_round` / `time_exhausted`) so a stale nonce
  fails gate 3.
- `backend/src/app.ts` — A01. Mount `webhook-router.ts` at `/webhooks/elevenlabs`. Ensure the raw
  body is available on this route (a raw-body middleware scoped to `/webhooks/*`), since `app.ts`
  installs `express.json()` globally.
- `backend/src/lib/env.ts` — F03. `ELEVENLABS_WEBHOOK_SECRET`, and the freshness window value.
- `backend/src/lib/error-codes.ts` — F01. Import `WEBHOOK_SIGNATURE_INVALID`,
  `WEBHOOK_REPLAY_REJECTED`, `VOICE_SESSION_INVALID`, `VOICE_SESSION_EXPIRED`,
  `INVALID_STATE_TRANSITION`. Add any missing voice code to the registry as a task step.
- The `Clock` seam (§5.5) — gate 2 (freshness) and gate 4 (ceiling) read the clock;
  `voice_webhook.feature` @AC-4 fixes it at `10:00:00Z`, sends a valid webhook at `10:04:00Z`
  (accepted), then at `10:05:01Z` past `expires_at 10:05:00Z` (→ `VOICE_SESSION_EXPIRED`,
  `evaluating`, `time_exhausted`).

  **The trap:** the gates must mutate nothing on failure, including the answer path. A bad-signature
  `submit_answer` must leave `current_index` unchanged and write no `answers` row
  (`voice_webhook.feature` @AC-3). Run **all** gates before touching I06; do not persist the answer
  and then validate.

## Steps
- [x] **1. Create `webhook-auth.ts`** — `verifySignature` (constant-time), `checkFreshness`,
  `authorizeSession` (unexpired + unconsumed), and `runGates` returning context-or-rejection.
- [x] **2. Add a raw-body capture** scoped to `/webhooks/*` in `app.ts` so the HMAC verifies the
  exact signed bytes.
- [x] **3. Create `webhook-router.ts`** — the three actions; run `runGates` first; on pass dispatch
  through I06 (`submit_answer`, `next_question`) and I07 (`end_round`, `time_exhausted`); log
  `VOICE_WEBHOOK_RECEIVED`.
- [x] **4. Wire gate 4's `time_exhausted`** — on ceiling passed, `applyTransition(→ evaluating)` +
  `ended_reason = 'time_exhausted'` + `VOICE_TIME_EXHAUSTED`; mark the session `consumed_at`.
- [x] **5. Enforce `end_round` legality** — accept only when the round's questions are exhausted or
  a shortening decision exists; else `409 INVALID_STATE_TRANSITION`.
- [x] **6. Confirm secret redaction** — no `nonce`/token/API key/transcript reaches a log line;
  wire the `LogSink` seam so @AC-10 can assert captured fields.
- [x] **7. Add missing voice codes** to `error-codes.ts` if any are absent (registry step).
- [x] **8. Wire acceptance step-defs** for `voice_webhook.feature`: @AC-3 (bad signature / stale
  timestamp → 401, state unchanged, no answer row, event emitted; then a correct one → 200), @AC-4
  (nonce no-match → 403 `VOICE_SESSION_INVALID`; after-ceiling → 403 `VOICE_SESSION_EXPIRED`, state
  `evaluating`, endedReason `time_exhausted`), @AC-5 (valid `submit_answer` → answer row
  `input_mode='voice'`, index advances; premature `end_round` → 409
  `INVALID_STATE_TRANSITION`), @AC-10 (LogSink redaction).
- [x] **9. Run the `## Verification` command.**

## Definition of done
- A webhook failing gate 1 or 2 returns 401 (`WEBHOOK_SIGNATURE_INVALID` / `WEBHOOK_REPLAY_REJECTED`),
  changes no state, and writes no answer row; a following correct webhook returns 200.
- A nonce matching no unexpired unconsumed row is `403 VOICE_SESSION_INVALID`; one after the ceiling
  is `403 VOICE_SESSION_EXPIRED` and the interview is `evaluating` with `ended_reason =
  'time_exhausted'`.
- A valid `submit_answer` persists an `answers` row with `input_mode = 'voice'` through the I06
  guarded advance and advances the clock; a premature `end_round` is `409 INVALID_STATE_TRANSITION`.
- No captured log field contains the nonce, session token, API key, or transcript text.

## Verification
```bash
npm run test:acceptance -- --tags "@voice-webhook"
```

Expected: every `voice_webhook.feature` scenario passes, zero failures, zero pending.

## Notes

```
6 scenarios (6 passed)
60 steps (60 passed)
```
Full gates after: default 52/52, auth 23/23, vitest 144/144 (22 new), lint + typecheck +
`npm run build` + `docker compose build` clean. Local runs need
`DATABASE_URL=…@localhost:5432/interviewly REDIS_URL=redis://localhost:6380`
(auth profile: `…/interviewly_test`) — `db`/`cache` resolve inside Docker only.

**What exists now**
- `modules/voice/webhook-auth.ts` — `verifySignature`, `checkFreshness`, `authorizeSession`,
  `isPastCeiling`, `consumeSession`, `runGates(req)` (gates 1–3; gate 4 is per-action, so it
  is the router's). `webhookSeam { secret, freshnessSeconds }` is the §5.5 override point.
- `modules/voice/webhook-router.ts` — `POST /webhooks/elevenlabs/:action`, mounted in `app.ts`
  at `/webhooks/elevenlabs`, no `requireAuth`, no `requirePublicOrigin`.
- `modules/voice/webhook-auth.test.ts` — 22 vitest cases on gates 1–2 (tampered body, wrong
  secret, signature valid for another payload, truncated digest, unset secret, skew both ways).

**Raw body:** `app.use('/webhooks', express.json({ verify }))` mounted **before** the global
`express.json()`; body-parser sets `req._body` so the global instance skips it and the buffer
lands on `req.rawBody`. **Constant-time:** `timingSafeEqual` on the two digest buffers, with a
length check first (`timingSafeEqual` throws on mismatched lengths; a digest length is public).
An unset `ELEVENLABS_WEBHOOK_SECRET` **fails closed**.

**Deviations**
- **ADR-V02-2** — gate 3 no longer filters on `expires_at`. As specified, an expired session was
  `VOICE_SESSION_INVALID` and @AC-4's `time_exhausted` end was unreachable. Expiry moved to gate 4;
  REFERENCE.md gates table patched.
- **I06 consumed via a new export**, not an HTTP self-call: `answers.ts` now exports
  `advanceWithAnswer(interview, body, { traceId })` and `submitAnswer` is a 3-line wrapper over it.
  Same guard, same `duration_ms`, one copy. `state.ts` exports `deliverCurrentQuestion` for
  `next_question`.
- **`VOICE_WEBHOOK_FRESHNESS_SECONDS`** added to `env.ts` + both `.env` files (default 300) — the
  task named a freshness window F03 had not defined.
- **No `LogSink` module.** Redaction is asserted by patching the `logger` singleton in the step
  file, the pattern `report-run.steps.ts` already established. A second seam would be a second
  thing to keep in sync.
- **`end_round` shortening** has no schema representation (adaptive D03 owns it); only an
  exhausted index is legal today. Marked `ponytail` in `webhook-router.ts`.

`consumed_at` **is** set — on `end_round` and on the `time_exhausted` end, both via
`consumeSession`, so a replayed nonce fails gate 3 afterwards.

**For V04:** import `verifySignature(rawBody, header)` and `checkFreshness(header)` from
`webhook-auth.ts` for `post_call` — they are exported individually precisely for this; do **not**
call `runGates`, which additionally requires a live unconsumed session `post_call` will not have.
`SIGNATURE_HEADER` / `TIMESTAMP_HEADER` are exported too. Mount the `post_call` route on the same
`/webhooks/elevenlabs` router so it inherits the raw-body parser; a route mounted elsewhere gets
no `req.rawBody` and every signature check fails. `webhookSeam.secret` is the acceptance override.

**Webhook body validation:** `advanceWithAnswer` takes **parsed** input, so `webhook-router.ts`
runs `answerInputSchema.safeParse` itself before calling it (`VALIDATION_ERROR` on failure).
`req.body.transcript` is untrusted `any` off the wire — skipping the parse typechecks fine and
silently drops the length/shape bounds the HTTP route enforces.

**Do not split this task's diff across commits.** `webhook-router.ts` imports `advanceWithAnswer`
(`answers.ts`), `deliverCurrentQuestion` (`state.ts`) and `config.VOICE_WEBHOOK_FRESHNESS_SECONDS`
(`env.ts`); a commit carrying the voice module without those three edits fails
`npm run -w @interviewly/backend build`, which is what `docker compose build` runs.
