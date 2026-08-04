# Voice — Decisions (append-only ADR log)

Never edit past entries. Supersede with a new dated entry referencing the one it changes.
Prefix `ADR-V` to avoid collision with foundations (`ADR-F`), auth (`ADR-A`) and
interview-core (`ADR-I`). Referenced back into `PLAN.md`.

---

## ADR-V01 — 2026-07-30 — ElevenLabs behind a `VoiceSession` seam; mint binds `expires_at` to the tighter ceiling

**Context:** K3 required a choice for the voice provider integration: (A) ElevenLabs Agents behind
a narrow `VoiceSession` interface with a `FakeVoiceSession` double, (B) call the ElevenLabs SDK
directly from the mint handler and room code, (C) our own STT+TTS+VAD pipeline. The interview
logic must stay server-side ("a mouth and an ear", §3.5), and `voice_fallback.feature` must run in
CI with no ElevenLabs network (§5.5).

**Decision:** ElevenLabs behind the `VoiceSession` seam. The interface exposes `mint(interviewId)`
returning `{ token, wssOrigin, dynamicVars: { interviewId, nonce }, expiresAt }`. The real
implementation (`elevenlabs-session.ts`) wraps the provider and mints a short-lived **signed
session token** — never the API key. `FakeVoiceSession` returns canned values and exposes
`failNext()` to force the next mint/turn to error. The mint endpoint writes a `voice_sessions`
row with an unguessable `nonce` and `expires_at = min(roundLeft, interviewLeft)` from the fixed
clock (720 s/round, 1500 s/interview from `env`).

**Why not the SDK inline (B):** with no seam, `voice_fallback.feature` cannot force a failure
without a live provider, so the mandatory fallback path (K3's whole point) becomes untestable.

**Why not our own pipeline (C):** turn-taking and barge-in are a week on their own (K3, rejected);
voice is the core promise, the wrong place to hand-roll.

**Consequences:** every caller (mint, room, fallback) is provider-agnostic. The API key stays in
`.env` server-side; a mint payload carrying it is a defect. The token's own provider TTL versus the
12/25-minute ceiling is unverified against the SDK (spec Open question 4) — mint to the tighter
ceiling and rely on the server-side webhook re-check (ADR-V02 gate 4) as the true enforcement; add
a refresh round-trip only if the provider TTL proves shorter than a round.

---

## ADR-V02 — 2026-07-30 — Webhook authentication is four ordered gates, mutating nothing on failure

**Context:** ElevenLabs drives the turn as server-to-server webhooks to `/webhooks/elevenlabs/*`
with **no browser cookie** (§3.5). Identity, authentication and authorisation must therefore ride
the payload and headers. Options: (A) HMAC signature only, (B) HMAC + a nonce lookup, (C) the full
four-gate chain — HMAC signature, timestamp freshness, `(interviewId, nonce)` against an unexpired
unconsumed `voice_sessions` row, then legal-K2-transition + wall-clock expiry.

**Decision:** the full four-gate chain, evaluated **in order**, short-circuiting on the first
failure, with **no state mutation** at any failing gate. Codes and statuses:
`WEBHOOK_SIGNATURE_INVALID` (401), `WEBHOOK_REPLAY_REJECTED` (401), `VOICE_SESSION_INVALID` (403),
`VOICE_SESSION_EXPIRED` (403), and the I07-owned `INVALID_STATE_TRANSITION` (409). A ceiling
passed at gate 4 ends the interview `time_exhausted` via the I07 transition.

**Why not HMAC only (A):** a valid signature proves the message came from someone holding the
secret, but not that it targets a live session or a legal transition; a replayed body re-drives the
machine. **Why not HMAC + nonce (B):** without the freshness window a captured valid call replays;
without the legality gate a webhook can request an illegal transition the browser UI never offers.
§7.1 item 4: a voice tool-call holds no authority a schema/state check does not grant — the
authority check, not caller trust, is the defence.

**Consequences:** this is the one new authenticated ingress in the system. `nonce`, the session
token and the API key are session secrets and are **never logged** (K6, §7.2); log lines carry
`interviewId` and `action` only, asserted via the `LogSink` seam (`voice_webhook.feature` @AC-10).
The post-call reconciliation webhook (ADR-V04) reuses gates 1–2 but authorises against the
*completed* session, since it legitimately arrives after the live session is consumed.

---

## ADR-V03 — 2026-07-30 — Downgrade is one-directional (`voice → text`), routed through the I07 transition

**Context:** any voice failure — no mic, permission denied, mint `VOICE_UNAVAILABLE`, WSS drop, a
`VoiceSession` fatal error — must not end the interview (§3.2, §3.8). Options: (A) continue the
*same* interview in text, `interviews.mode` `voice → text` only, same `interviewId`/index; (B)
abort and restart in text (a new interview); (C) allow re-upgrade to voice when the fault clears.

**Decision:** (A). The downgrade sets `interviews.mode = 'text'` on the same interview, preserves
every recorded answer and the `current_index`, emits `VOICE_DOWNGRADED_TO_TEXT` (the single most
operationally important line — it explains why a "voice" interview has text answers), and never
returns to `voice`. A mint attempted after a downgrade is refused `INVALID_STATE_TRANSITION`. The
mode write is not a new state edge — it consumes the I07 machine and the I06 answer path unchanged.

**Why not restart (B):** loses the candidate's answers and their place — the exact data-loss the
invariant forbids. **Why not re-upgrade (C):** mid-interview mode flapping is a UX and accounting
hazard for no benefit; §3.8 fixes the direction as `voice → text`, never the reverse.

**Consequences:** `voice_fallback.feature` drives `FakeVoiceSession` to fail and asserts the mode
becomes `text`, earlier voice answers keep `input_mode='voice'`, later answers are `input_mode='text'`,
the index is unchanged, and a post-downgrade mint is `409 INVALID_STATE_TRANSITION`. The candidate
never depends on the voice layer — the mandatory-requirement guarantee.

---

## ADR-V04 — 2026-07-30 — Reconciliation runs in `worker`, one idempotent K13 transaction

**Context:** the voice session is metered by ElevenLabs and our gateway is not in its path, so a
per-call budget check is impossible (§7.3). Usage is known only post-call. Options for where and
how to reconcile: (A) `worker` consumes a BullMQ job enqueued by the authenticated post-call
webhook and writes the `llm_calls` row + `spent_usd` increment in one transaction; (B) the API
request thread does it inline in the webhook handler; (C) a periodic sweep polls ElevenLabs.

**Decision:** (A). The post-call webhook (HMAC + freshness verified, ADR-V02 gates 1–2) enqueues a
job keyed by `interviewId`; `worker/src/jobs/voice-reconcile.ts` writes one `llm_calls` row
(`provider='elevenlabs'`, `unit_kind='second'`, `units = seconds`) and increments
`interviews.spent_usd` by the reconciled cost **in the single K13 transaction** (the I08 contract).
The job is **idempotent**: it first checks for an existing `(interview_id, provider='elevenlabs')`
`llm_calls` row and no-ops if one exists, so a redelivered webhook writes nothing more and leaves
`spent_usd` unchanged.

**Why not inline in the API (B):** K10 keeps report/accounting load off API request threads;
`worker` already owns voice reconciliation and the sweeper (§3.5, K10). **Why not a poll (C):** a
cron poll adds a moving part and latency for a signal ElevenLabs already pushes.

**Consequences:** hitting either ceiling sets `ended_reason = 'time_exhausted'` (set by ADR-V02
gate 4, not here); the report is generated from whatever answers exist. Idempotency by existence
check needs **no new column** — one voice reconciliation per interview. `VOICE_USAGE_RECONCILED`
logs the seconds and the reconciled `spent_usd`, never a transcript. `worker` imports
`@interviewly/ai` and `backend/src/lib/db.ts`'s transaction only through their published surface.

---

## ADR-V02-2 — 2026-08-03 — Gate 3 checks existence + unconsumed; expiry belongs to gate 4

**Context:** ADR-V02 and REFERENCE.md both described gate 3 as matching an *unexpired, unconsumed*
row, rejecting `expires_at ≤ now` as `VOICE_SESSION_INVALID`. `voice_webhook.feature` @AC-4 says
otherwise: a nonce nobody minted is `VOICE_SESSION_INVALID` (403), a nonce whose ceiling passed is
`VOICE_SESSION_EXPIRED` (403) **and ends the interview `time_exhausted`**. Folding expiry into the
gate-3 lookup collapses both into the first and the interview never ends.

**Decision:** `authorizeSession` filters on `(interview_id, nonce, consumed_at: null)` only. The
ceiling is gate 4's, read from `session.expires_at` — which is already `min(round, interview)` from
the mint (ADR-V01), so no second clock source exists.

**Consequences:** the two rejections stay distinguishable, which is what makes @AC-4's
`time_exhausted` assertion reachable. REFERENCE.md's gate-3 row patched to match. V04's `post_call`
webhook is unaffected: it runs gates 1–2 only.

---

## ADR-V03-2 — 2026-08-04 — `mode` is a guarded column write, not an I07 transition; only a driver failure downgrades

**Context:** ADR-V03 says the downgrade is "routed through the I07 transition". `applyTransition`
writes `interviews.state` and nothing else — it has no `mode` parameter and `mode` is not a K2
edge — so there is no I07 path to route through. Separately, the mint refuses for four reasons
(non-owner, kill switch off, non-voice-capable state, driver failure) and only one of them is a
voice failure.

**Decision:** `downgradeToText` is a single guarded `updateMany({ where: { id, mode: 'voice' } })`.
The `mode: 'voice'` predicate *is* both the one-directional rule and the idempotency — a repeat
signal matches no row, rewrites nothing and emits no second event. Only the `VoiceSession.mint`
call is wrapped: a pre-check refusal has not failed at voice and must not spend the one-way
downgrade. The mint's `mode !== 'voice'` refusal changed `VOICE_UNAVAILABLE` → `INVALID_STATE_TRANSITION`,
which is what `voice_fallback.feature` @AC-6 asserts for a post-downgrade mint.

**Consequences:** no endpoint ships in V03 — the client-signalled degradations (mic denied, WSS
drop) call the exported `downgradeToText` from V05's pre-join, which is where the spec puts them.
Kill-switch-off still returns 503 and leaves `mode = 'voice'`, so `voice_session.feature` @AC-2 is
unaffected.
