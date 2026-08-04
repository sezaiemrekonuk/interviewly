# Voice — REFERENCE (read this once, then you don't need to spelunk)

Single orientation doc for any agent executing a task in this ledger. It reflects the project
layout **as it exists after foundations F01/F02/F03, auth A01, and interview-core I03/I06/I07/I08
are done**. If a path listed here does not exist, its providing task has not landed — check
STATE.md's Cross-ledger table before proceeding. Verified against the foundations, auth and
interview-core task files and the voice spec as of 2026-07-30. If reality diverges, trust the code
and patch this file.

## Services, ports, roles

| Service | Package | Port (internal) | DB role | Trust |
|---|---|---|---|---|
| `api` | `backend/` | 4000 | reads/writes all tables | trusted internal; Caddy terminates TLS |
| `worker` | `worker/` | none | reads/writes | trusted internal; runs the reconciliation job |
| `db` | Postgres (compose) | 5432 | persistence | not published on host (K14) |
| `cache` | Redis (compose) | 6379 | rate-limit, SSE, BullMQ | not published on host |
| `web` | `frontend/` | 3000 | none | public via Caddy |
| `edge` | Caddy | 80 (host) | none | single published port; one CSP `connect-src` exception (§7.4) |

The voice module runs inside `api`. ElevenLabs reaches it **server-to-server** at
`edge → /webhooks/elevenlabs/*` (K14 §11.5 note: `/webhooks/*` is proxied to `api`). The browser
connects **directly** to the ElevenLabs WSS with the minted token — the one single-origin exception.
`@interviewly/ai` and `backend/src/lib/db.ts`'s transaction are imported by `worker` for
reconciliation.

## Commands

```bash
# Start core services (from repo root)
docker compose up -d db cache

# Backend (from backend/)
npm install
npx prisma migrate deploy
npm run dev                     # tsx watch

# Worker (from repo root)
npm run -w worker build
npm run -w worker test          # V04 worker-level reconciliation test

# The Cucumber acceptance runner runs from the repo root (wired by F03/CI).
# Voice feature files carry unique area tags — verify by the area tag alone:
npm run test:acceptance -- --tags "@voice-session"
npm run test:acceptance -- --tags "@voice-webhook"
npm run test:acceptance -- --tags "@voice-fallback"
npm run test:acceptance -- --tags "@voice-reconciliation"
# All voice acceptance at once:
npm run test:acceptance -- --tags "@voice"
```

**Tag rule (read before writing any Verification command):** `@AC-<n>` tags are **not** unique
across feature files. Each voice feature file has a unique **area** tag (`@voice-session`,
`@voice-webhook`, `@voice-fallback`, `@voice-reconciliation`) — verify by that alone. Never verify
a voice task by `@AC-n`.

## HTTP contracts (voice surface)

All error responses use the envelope `{ "error": { "code": "…" } }` with a stable
SCREAMING_SNAKE_CASE code — never a display string. The mint endpoint is ownership-checked (a
non-owner is `403 FORBIDDEN` per the spec's mint table; note the mint contract returns `FORBIDDEN`,
unlike the interview `:id` routes which return `404 INTERVIEW_NOT_FOUND` — the mint's
`voice_session.feature` @AC-2 fixes this).

| Method + Path | Auth | Success | Error codes | Task |
|---|---|---|---|---|
| `POST /interviews/:id/voice/session` | `requireAuth` | 201 `{ token, wssOrigin, dynamicVars: { interviewId, nonce }, expiresAt }` | `INTERVIEW_NOT_FOUND`, `FORBIDDEN`, `UNAUTHENTICATED`, `VOICE_UNAVAILABLE`, `INVALID_STATE_TRANSITION` | V01 |
| `POST /webhooks/elevenlabs/submit_answer` | HMAC + 4 gates | 200 | `WEBHOOK_SIGNATURE_INVALID`, `WEBHOOK_REPLAY_REJECTED`, `VOICE_SESSION_INVALID`, `VOICE_SESSION_EXPIRED`, `INVALID_STATE_TRANSITION` | V02 |
| `POST /webhooks/elevenlabs/next_question` | HMAC + 4 gates | 200 | same as above | V02 |
| `POST /webhooks/elevenlabs/end_round` | HMAC + 4 gates | 200 (only when exhausted/shortened) | same as above | V02 |
| `POST /webhooks/elevenlabs/post_call` | HMAC + freshness | 202 (enqueued) | `WEBHOOK_SIGNATURE_INVALID`, `WEBHOOK_REPLAY_REJECTED` | V04 |

**Mint payload** — never contains `ELEVENLABS_API_KEY`. `token` is a short-lived signed session
token; `wssOrigin` is the origin the CSP `connect-src` must allow; `dynamicVars` are echoed back by
every webhook; `expiresAt = min(roundLeft, interviewLeft)` from the clock (720/1500 s ceilings).

**Webhook headers** — `X-ElevenLabs-Signature: sha256=…` (HMAC-SHA256 over the **raw** body, key
`ELEVENLABS_WEBHOOK_SECRET`) and `X-ElevenLabs-Timestamp`. **Body** —
`{ interviewId, nonce, transcript?, …action-specific }`.

## The four webhook gates (V02 — the new trust boundary)

Evaluated **in order**, short-circuiting on the first failure, mutating nothing on failure:

1. **Signature** — recompute HMAC-SHA256 over the raw body; constant-time compare to the header.
   Mismatch → `WEBHOOK_SIGNATURE_INVALID` (401).
2. **Freshness** — `X-ElevenLabs-Timestamp` within the window; outside → `WEBHOOK_REPLAY_REJECTED`
   (401).
3. **Authorisation** — `(interviewId, nonce)` matches an **unconsumed** `voice_sessions` row; no
   match / consumed → `VOICE_SESSION_INVALID` (403). **Expiry is deliberately not checked here**
   (ADR-V02-2): an expired session existed, and gate 4 must be able to tell the two apart.
4. **Legality + expiry** — the wall-clock ceiling (`session.expires_at`) has not passed, and the
   requested K2 transition is legal from the current state (I07). Ceiling passed →
   `VOICE_SESSION_EXPIRED` (403) and the interview ends `time_exhausted` (via I07
   `applyTransition(→ evaluating)`, `ended_reason = 'time_exhausted'`); illegal transition →
   `INVALID_STATE_TRANSITION` (409).

## `VoiceSession` seam (V01)

```ts
export interface VoiceSession {
  mint(interviewId: string): Promise<{
    token: string;        // short-lived signed session token — never the API key
    wssOrigin: string;    // the origin the CSP connect-src must allow (§7.4)
    dynamicVars: { interviewId: string; nonce: string };
    expiresAt: string;    // min(roundCeiling, interviewCeiling) from now (§7.3)
  }>;
}
// FakeVoiceSession.failNext() forces the next mint/turn to error → exercises downgrade (§5.5)
```

## Key code anchors

All paths relative to repo root. Each exists once its providing task lands; voice-owned files are
marked with the creating task.

| Path | Task | What it does |
|---|---|---|
| `backend/src/lib/error-codes.ts` | F01 | Error-code registry; add any missing voice code here in a task step |
| `backend/src/lib/db.ts` | F02 | Prisma singleton + `$transaction`; `userInterviews`, `activeInterview` |
| `backend/src/lib/logger.ts` | F03 | Pino factory: `logger.<level>({ traceId, interviewId }, "EVENT")` |
| `backend/src/lib/env.ts` | F03 | Zod env config: `ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK_SECRET`, `ELEVENLABS_AGENT_ID_HR/_TECH`, `VOICE_MAX_ROUND_SECONDS`, `VOICE_MAX_INTERVIEW_SECONDS`, `AI_ENABLED`, `PUBLIC_ORIGIN` |
| `backend/src/app.ts` | A01 | Express app + global error handler + traceId; voice mounts its routers here |
| `backend/modules/auth/middleware.ts` | A01 | `requireAuth` (guards the mint endpoint) |
| `backend/modules/interview/ownership.ts` | I03 | Resolve `:id` for the session user |
| `backend/modules/interview/state.ts` | I03 | `GET /state` room-state (mint reads the voice-capable state) |
| `backend/modules/interview/answers.ts` | I06 | `POST /answers` guarded advance (webhook `submit_answer` reuses it) |
| `backend/modules/interview/machine.ts` | I07 | `applyTransition` — sole writer of `interviews.state`; downgrade + `time_exhausted` route here |
| `backend/modules/interview/budget.ts` | I08 | `spent_usd` + `llm_calls` single-transaction contract |
| `backend/modules/voice/VoiceSession.ts` | **V01** | The K3 seam interface |
| `backend/modules/voice/elevenlabs-session.ts` | **V01** | Real driver: wraps ElevenLabs, mints the signed token |
| `backend/modules/voice/fake-session.ts` | **V01** | `FakeVoiceSession` with `failNext()` (§5.5) |
| `backend/modules/voice/session.ts` | **V01** | `POST /interviews/:id/voice/session` handler; writes `voice_sessions` |
| `backend/modules/voice/webhook-auth.ts` | **V02** | The four gates + HMAC/freshness verifier (reused by V04) |
| `backend/modules/voice/webhook-router.ts` | **V02** | `submit_answer` / `next_question` / `end_round` handlers |
| `backend/modules/voice/downgrade.ts` | **V03** | `downgradeToText` — guarded `mode: voice → text` update (ADR-V03-2, not `applyTransition`); `VOICE_DOWNGRADED_TO_TEXT` |
| `backend/modules/voice/reconcile-webhook.ts` | **V04** | `post_call` webhook: verify (gates 1–2) + enqueue the job |
| `worker/src/jobs/voice-reconcile.ts` | **V04** | Writes `llm_calls` + `spent_usd` in one idempotent transaction |
| `worker/src/lib/logger.ts`, `worker/src/lib/env.ts` | F03 | Worker's pino factory + env subset |

## Schema (tables this ledger reads/writes)

Owned by F02 — **no structural change here** (ADR-F02 / §10). Voice reads and writes only:

- `voice_sessions` — `id`, `interview_id`, `nonce` (unguessable secret), `expires_at`,
  `consumed_at`. Written on mint (V01); `consumed_at` set on session close; the webhook authorises
  against an unexpired, unconsumed row (V02 gate 3).
- `answers` — written by the I06 guarded advance with `input_mode = 'voice'` on a voice
  `submit_answer` (V02).
- `interviews` — `mode` (`voice → text` on downgrade, V03; guarded on `mode: 'voice'`), `state`/`ended_reason`
  (`time_exhausted` via I07, V02 gate 4), `spent_usd`/`budget_usd` (reconcile via I08 tx, V04),
  `current_index` (never rewound by a downgrade).
- `llm_calls` — one reconciliation row (V04): `provider='elevenlabs'`, `unit_kind='second'`,
  `units = seconds`, `cost_usd`, `trace_id`. Idempotency: existence check on
  `(interview_id, provider='elevenlabs')`.

## Conventions

**Error codes** are imported from `backend/src/lib/error-codes.ts`, never inlined. Voice codes
(add any missing one to the registry in a task step, as auth/interview-core did):
`WEBHOOK_SIGNATURE_INVALID`, `WEBHOOK_REPLAY_REJECTED`, `VOICE_SESSION_INVALID`,
`VOICE_SESSION_EXPIRED`, `VOICE_UNAVAILABLE`. Consumed (already in F01):
`INVALID_STATE_TRANSITION`, `FORBIDDEN`, `UNAUTHENTICATED`, `INTERVIEW_NOT_FOUND`,
`VALIDATION_ERROR`.

**Log shape:** `logger.<level>({ traceId, interviewId }, "EVENT_NAME")` — structured object first,
event name second, never a display string. Voice events: `VOICE_SESSION_MINTED`,
`VOICE_WEBHOOK_RECEIVED` (with `action`), `WEBHOOK_SIGNATURE_INVALID`, `WEBHOOK_REPLAY_REJECTED`,
`VOICE_SESSION_INVALID`, `VOICE_SESSION_EXPIRED`, `VOICE_DOWNGRADED_TO_TEXT`,
`VOICE_USAGE_RECONCILED`, `VOICE_TIME_EXHAUSTED`. **The `nonce`, the session token, the API key and
any transcript text are session secrets and are NEVER logged** (K6, §7.2) — `voice_webhook.feature`
@AC-10 asserts this via the `LogSink` seam.

**Secrets:** the `ELEVENLABS_API_KEY` lives in `.env` only and never reaches a mint payload or a
log line. The webhook secret is used only to verify HMAC. The `nonce` is returned only to the
owner in the mint payload and never to a non-owner.

**External calls** (the real ElevenLabs mint) have a timeout, a retry policy and a bounded wait
(§8.3); a mint failure surfaces as `VOICE_UNAVAILABLE` (the client's cue to downgrade), not an
unhandled throw. The acceptance ring uses `FakeVoiceSession` and posts webhooks in-process — no
network.

**Migration rule (ADR-F02):** no structural schema change in this ledger. If reconciliation ever
needs an ElevenLabs usage-id column it is a **new nullable-column migration** rebased on F02, never
an edit to the F02 migration SQL.
