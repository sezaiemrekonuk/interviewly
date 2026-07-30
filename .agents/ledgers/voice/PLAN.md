# Voice — PLAN (Architecture)

Written once. Amend only via a new `DECISIONS.md` ADR-V entry referenced here.
Codebase orientation: `REFERENCE.md` (read that before touching any task).

## Goal

When this ships, an interview can be run in voice mode: the browser connects **directly** to
ElevenLabs with a short-lived signed session token minted by the API, ElevenLabs drives the
turn as server-to-server webhooks back to `/webhooks/elevenlabs/*`, and every one of those
webhooks is authenticated (HMAC + freshness + nonce + legality/expiry) before it may touch an
interview. Any voice failure downgrades the *same* interview to text with no data loss, and the
post-call usage is reconciled into `spent_usd` by `worker`. `voice_fallback.feature`,
`voice_webhook.feature`, `voice_session.feature` and `voice_reconciliation.feature` all green is
the observable end-to-end result. Nothing in the text MVP depends on this ledger (§12).

## The invariant this initiative must not weaken

> A forged, replayed, or expired webhook can never advance an interview, and no voice failure may
> ever lose an answer or leave the candidate stranded — the text path is always reachable. (K3,
> §3.5)

Voice is the project's **widest trust boundary**: a browser talking to a third party, and that
third party calling us back with no browser cookie. This ledger introduces exactly one new
authenticated ingress (`/webhooks/elevenlabs/*`) and one CSP relaxation (the ElevenLabs WSS
origin), and nothing else. It **consumes** the K2 state machine, answer persistence and budget
transaction rather than reimplementing them; it deliberately does not touch the transition table
itself (I07 owns it), the guarded advance (I06 owns it), or the `spent_usd`/`llm_calls`
transaction shape (I08/K13 own it).

## Topology

```
Browser ───────── WSS (direct, minted token) ─────────▶ ElevenLabs Agent
   │  ▲                                                       │
   │  │ POST /interviews/:id/voice/session (mint, requireAuth)│  server-to-server
   │  │                                                       │  webhooks (no cookie)
   ▼  │                                                       ▼
edge/ (Caddy — single published port; CSP connect-src allows the one WSS origin, §7.4)
   │                                                          │
   ▼                                                          ▼
backend/src/app.ts                              backend/modules/voice/webhook-router.ts
   ├── modules/voice/                              mounts /webhooks/elevenlabs/:action
   │     session.ts        ← POST …/voice/session: mint token, write voice_sessions row
   │     VoiceSession.ts    ← the K3 seam interface
   │     elevenlabs-session.ts ← real driver (wraps ElevenLabs); mints the signed token
   │     fake-session.ts    ← FakeVoiceSession test double (failNext), §5.5
   │     webhook-auth.ts    ← the 4 gates: HMAC → freshness → nonce authz → legality+expiry
   │     webhook-router.ts  ← submit_answer / next_question / end_round handlers
   │     reconcile-webhook.ts ← post-call webhook: verify + enqueue the worker job
   │     downgrade.ts       ← voice → text (consumes I07 transition), VOICE_DOWNGRADED_TO_TEXT
   │
   ├── modules/interview/   ← CONSUMED, not modified
   │     answers.ts (I06)   ← submit_answer persists a voice answer through the guarded advance
   │     machine.ts (I07)   ← the K2 transition authority; downgrade + time_exhausted route here
   │     budget.ts (I08)    ← the spent_usd + llm_calls single-transaction contract
   │
   ├── Postgres             ← voice_sessions (F02), answers.input_mode='voice', llm_calls,
   │                          interviews.mode / spent_usd / ended_reason
   └── Redis                ← BullMQ voice-reconciliation queue

worker/
   src/jobs/voice-reconcile.ts ← writes llm_calls(provider='elevenlabs', unit_kind='second')
                                 and reconciles spent_usd in one K13 transaction (idempotent)
```

## Decision table (full ADRs in DECISIONS.md)

| # | Decision | Chosen | Reason |
|---|----------|--------|--------|
| ADR-V01 | Voice provider boundary | ElevenLabs behind a `VoiceSession` seam + `FakeVoiceSession`; mint binds `expires_at` to `min(roundLeft, interviewLeft)` | K3 names the seam as the test seam (§5.5); a provider-agnostic interface makes `voice_fallback.feature` runnable with no network |
| ADR-V02 | Webhook authentication | Four ordered gates — HMAC-SHA256, timestamp freshness, `(interviewId, nonce)` against an unexpired/unconsumed row, then legality+expiry — any failure mutates nothing | §3.5: webhooks are authenticated *data*, not trusted callers; a forged or replayed call must not re-drive the K2 machine |
| ADR-V03 | Downgrade direction | `interviews.mode` goes `voice → text` only, never the reverse; the downgrade routes through the I07 transition, same `interviewId`/index | §3.2/§3.8: the mandatory fallback guarantee — the candidate never depends on the voice layer |
| ADR-V04 | Reconciliation location + idempotency | `worker` writes the `elevenlabs`/`second` `llm_calls` row and increments `spent_usd` in the single K13 transaction; idempotent by one row per `(interview_id, provider='elevenlabs')` so redelivery is a no-op | §7.3/K10: report load stays off API threads; ElevenLabs may deliver the post-call webhook more than once |

## Data model additions

**No structural changes.** This ledger reads and writes columns F02 already shipped:

| Table | Voice reads | Voice writes |
|---|---|---|
| `voice_sessions` | `interview_id`, `nonce`, `expires_at`, `consumed_at` | `INSERT` on mint; `consumed_at` on session close |
| `answers` | — | `INSERT` with `input_mode = 'voice'` (via the I06 guarded advance) |
| `interviews` | `state`, `current_index`, `mode`, `spent_usd`, `budget_usd`, `ended_reason` | `mode = 'text'` on downgrade; `ended_reason = 'time_exhausted'` on ceiling; `spent_usd` reconcile (via I08/K13 tx) |
| `llm_calls` | `(interview_id, provider)` existence check for idempotency | `INSERT` `provider='elevenlabs'`, `unit_kind='second'`, `units = seconds` |

Reconciliation dedup uses **an existence check on `(interview_id, provider='elevenlabs')`** — a
second post-call delivery finds the row and no-ops. No new column is required; if a future need
for the ElevenLabs usage id arises it is a **nullable column in its own migration, rebased on
F02** (backlog), never an edit to the F02 migration.

## Webhook trust boundary (this ledger's core mechanic)

`/webhooks/elevenlabs/:action`, `action ∈ { submit_answer, next_question, end_round }`, carries no
browser cookie. Every webhook passes **four gates, in order** — a failure at any gate rejects and
mutates nothing:

1. **Signature** — HMAC-SHA256 over the raw body against `ELEVENLABS_WEBHOOK_SECRET`; mismatch →
   `WEBHOOK_SIGNATURE_INVALID` (401).
2. **Freshness** — `X-ElevenLabs-Timestamp` inside the window; outside → `WEBHOOK_REPLAY_REJECTED`
   (401).
3. **Authorisation** — `(interviewId, nonce)` matches an **unexpired, unconsumed** `voice_sessions`
   row; no match / consumed / `expires_at` passed → `VOICE_SESSION_INVALID` (403).
4. **Legality + expiry** — the requested transition is legal from the current K2 state (I07), and
   the wall-clock ceiling has not passed. Illegal → `INVALID_STATE_TRANSITION` (409, owned by
   I07); ceiling passed → `VOICE_SESSION_EXPIRED` (403) and the interview ends `time_exhausted`.

The post-call **reconciliation** webhook reuses gates 1–2 (HMAC + freshness) but authorises by
`interview_id` against the *completed* session — it is expected after the live session is consumed,
so it must not be held to the unexpired-unconsumed gate. This is why V04 depends on V02.

## Phasing / task clusters (see STATE.md ledger)

0. Session seam + mint (V01) — `VoiceSession` interface, `FakeVoiceSession`, the real ElevenLabs
   driver scaffold, `POST /interviews/:id/voice/session`
1. Webhook authentication (V02) — the four gates + `submit_answer`/`next_question`/`end_round` + log redaction
2. Fallback (V03) — `voice → text` downgrade driven by `FakeVoiceSession`
3. Reconciliation (V04) — the `worker` post-call job, one idempotent transaction

## Out of scope (post-voice)

- **The K2 state machine, the guarded advance, the `spent_usd`/`llm_calls` transaction shape** —
  `interview-core` (I06, I07, I08). Voice consumes them; it never reimplements them.
- **The `voice_sessions` / `answers` / `llm_calls` table + enum shapes** — `db` (K13, F02).
- **Prompt building, occupation/language logic, price tables** — `ai` (K9, K15). The voice agent
  is "a mouth and an ear".
- **The room shell, React Query data layer, i18n, the text-mode `EventAvatarDriver` wiring** —
  `frontend` (K11, §3.8).
- **The CSP edge mechanics, the `cloudflared` tunnel, `.env`/key delivery** — `infra` (K14, §7.4,
  §9.3). Voice *supplies* the WSS origin and *requires* the tunnel; infra makes them serve.
- **The avatar assets and the `AvatarState` enum** — `ui` (§3.6).
- **`security.feature` (prompt-injection, `@AC-3/4/5`)** — that is `interview-core`'s
  (`PromptBuilder` boundary). Voice owns only `voice_session`, `voice_webhook`, `voice_fallback`,
  `voice_reconciliation`.
- **Out of the acceptance ring — browser/hardware, no Cucumber tag (COVERAGE.md):**
  - **AC-8** — the self-camera tile off-by-default and local-only (`getUserMedia` bound to a local
    `<video>`, no upload/recording). Browser-observable; a Playwright smoke may exist.
  - **AC-9** — the built voice room opening exactly one cross-origin `wssOrigin` connection with
    every other request same-origin. Edge-CSP/browser-observable only.
  - The `AmplitudeAvatarDriver` / voice-room surface (§3.2, §3.6) — frontend, gated on the SDK
    audio-surface spike (Open question, STATE.md). The event driver serves both modes if the spike
    fails; the avatar and its score do not depend on the answer.

**The entire schema lives in F02. This ledger may add indexes and nullable columns only, each in
its own migration, rebased before merge. Any structural change is a change to F02's scope and gets
discussed, not merged** — the week-one collision §10 calls the one unacceptable failure.
