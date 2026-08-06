# Speech — Decisions (append-only ADR log)

Never edit past entries. Supersede with a new dated entry referencing the one it changes.
Prefix `ADR-S` to avoid collision with foundations (`ADR-F`), auth (`ADR-A`), interview-core
(`ADR-I`) and voice (`ADR-V`). Referenced back into `PLAN.md`.

Several entries here supersede voice ADRs. Those are not edited — `.agents/ledgers/voice/
DECISIONS.md` stays as written, because it is the honest record of a decision that was made,
built, and then reversed by the owner.

---

## ADR-S01 — 2026-08-06 — ElevenLabs is a TTS + STT vendor, not a conversation agent (supersedes ADR-V01)

**Context:** V01 put ElevenLabs behind a `VoiceSession` seam whose single method minted a signed
WSS URL for the browser to dial an ElevenLabs **Conversational AI agent**
(`elevenlabs-session.ts:46`, `/v1/convai/conversation/get_signed_url`). The agent was to drive
the turn and return answers as server-to-server tool webhooks. That shape needs: two provisioned
agents, tool definitions maintained in a vendor console, a webhook secret, a publicly reachable
ingress, and a `cloudflared` tunnel in dev. None of it was ever configured, and the room was
never built to send or play audio at all. Options: (A) finish the convai integration —
provision agents, configure tools, wire the tunnel; (B) keep the vendor, drop the agent — call
text-to-speech to ask and speech-to-text to transcribe, both server-side; (C) drop ElevenLabs.

**Decision:** (B), by the owner: *ElevenLabs for voice generation only.* `SpeechProvider`
replaces `VoiceSession`; `speak()` and `transcribe()` replace `mint()`. The interview logic that
convai would have hosted already exists in this repo — I06 advances the answer, I07 owns the
transitions, `ai` generates the questions. The agent was going to duplicate it behind a vendor
console.

**Why not (A):** it buys a vendor-hosted copy of logic we already own, and pays for it with an
authenticated public ingress, a tunnel, and configuration that lives outside the repo where no
test can see it. Four of the five P0 voice issues (#56, #57, #58, #59) are that configuration
surface failing.

**Why not (C):** the TTS quality is the product. The problem was never the vendor.

**Consequences:** `voice_session.feature`, `voice_webhook.feature` and
`voice_reconciliation.feature` describe a system that will not exist and are deleted with the
code (S05). `.agents/specs/2026-07-29-voice.md` is marked superseded; its AC-1…AC-7, AC-9 and
AC-10 do not carry over. V01–V05 stay `done` — they were done. `personas.voice_id`, seeded
since F02 and unused, becomes load-bearing.

---

## ADR-S02 — 2026-08-06 — Both provider calls are server-side

**Context:** the convai design had the browser hold a short-lived signed URL and dial
`wss://api.elevenlabs.io` directly, which required relaxing the CSP `connect-src 'self'` at
`frontend/src/middleware.ts:9` (issue #57, still open and unfixed). With TTS/STT there is a real
choice again. Options: (A) browser calls ElevenLabs directly with a scoped credential;
(B) backend calls ElevenLabs, browser talks only to our origin.

**Decision:** (B). `GET …/questions/:index/speech` returns audio bytes from our origin;
`POST …/answers/audio` uploads to our origin. `ELEVENLABS_API_KEY` is read only in
`backend/modules/speech/elevenlabs-speech.ts`.

**Why not (A):** ElevenLabs has no per-session scoped credential for the plain TTS/STT
endpoints — a browser-side call means shipping the account key, and a key in a JS bundle is a
key on the open internet. It would also reintroduce the CSP relaxation this decision retires.

**Consequences:** issue #57 closes as obsolete rather than fixed. `speech AC-9` asserts the CSP
string still reads `connect-src 'self'` and that no `WebSocket` is constructed anywhere in
`frontend/src` — a regression test for the architecture, not just for the header. The backend
now carries the audio bytes, so the STT route needs the upload limits `uploads.ts` already
defines, and both routes need rate limits (#120's class).

---

## ADR-S03 — 2026-08-06 — The webhook trust boundary is deleted, not disabled (supersedes ADR-V02)

**Context:** V02 built four ordered gates over `/webhooks/elevenlabs/:action` — HMAC-SHA256 over
the raw body, timestamp freshness, `(interviewId, nonce)` against an unexpired unconsumed
`voice_sessions` row, then legality + expiry (`webhook-auth.ts`, 375 lines of step definitions
asserting it). ADR-V01's premise is gone, so nothing will ever call that route. Options:
(A) leave the router mounted and unreachable; (B) leave it mounted behind a kill switch;
(C) delete the router, the gates, the secret, the raw-body parser and the tunnel.

**Decision:** (C). S05 removes `webhook-router.ts`, `webhook-auth.ts`, `reconcile-webhook.ts`,
the raw-body parser at `app.ts:24-29`, the two mounts at `app.ts:62-63`,
`ELEVENLABS_WEBHOOK_SECRET`, `VOICE_WEBHOOK_FRESHNESS_SECONDS`, and `compose.dev.yaml`'s
`cloudflared` service.

**Why not (A) or (B):** an unauthenticated-by-design public route that nothing calls is a
liability with no upside, and it fails open the moment someone sets the secret "to make the
tests pass". More quietly: dead security code reads to the next person like a live defence, and
they will reason about the system as though the gates are protecting something.

**Consequences:** four error codes lose their only producer and go with the code —
`WEBHOOK_SIGNATURE_INVALID`, `WEBHOOK_REPLAY_REJECTED`, `VOICE_SESSION_INVALID`,
`VOICE_SESSION_EXPIRED` (`error-codes.ts:43-46`) and their copy in both locales
(`frontend/messages/{en,tr}.json:274-277`). **`VOICE_SESSION_EXPIRED` is the exception: it is
kept**, because the ceiling still needs a code and this one already has copy in both locales.
Deleting the gates deletes `isPastCeiling` — see ADR-S06, which is where that duty moves.

---

## ADR-S04 — 2026-08-06 — Usage is metered per call, not reconciled after the fact (supersedes ADR-V04)

**Context:** V04 metered voice by a post-call webhook that enqueued a BullMQ job, which wrote
one `llm_calls` row per interview inside a transaction guarded by an existence check on
`(interview_id, provider='elevenlabs')` — idempotent because ElevenLabs may deliver a webhook
more than once. Under ADR-S01 there is no post-call webhook and no redelivery. Options: (A) keep
a deferred job, enqueued by the routes; (B) write the `llm_calls` row synchronously at each
provider call site, inside I08's `withBudget` transaction.

**Decision:** (B). TTS bills `unit_kind='character'` with `model='tts'`; STT bills
`unit_kind='second'` with `model='stt'`. Both use the existing `recordLlmCall`
(`src/lib/db.ts`) inside `withBudget` (I08), so the insert and the `spent_usd` increment share
one transaction exactly as the AI calls already do.

**Why not (A):** deferral bought idempotency against redelivery, and there is no redelivery. It
would leave a queue, a worker, and a failure mode (a lost job = unbilled usage, #81's shape) in
exchange for nothing.

**Consequences:** `worker/src/jobs/voice-reconcile.ts`, `modules/voice/reconcile.ts`, the
`voice.reconcile` queue (`src/lib/queue.ts:29,32`) and their exports all go in S05.
`packages/ai/config/model-prices.yaml:23-26` replaces `elevenlabs/conversational` with an
`elevenlabs/tts` per-character row and an `elevenlabs/stt` per-second row. `UnitKind` already
has both `character` and `second` (F02), so no enum migration is needed — the one place this
decision could have cost a schema change, and does not.

---

## ADR-S05 — 2026-08-06 — `voice_sessions` is dropped

**Context:** the table exists to hold `(interview_id, nonce, expires_at, consumed_at)` — a mint
credential and its ceiling, read only by webhook gate 3 and gate 4. Under ADR-S01 there is no
mint and no nonce; under ADR-S03 there is no gate. Options: (A) keep the table, unwritten;
(B) repurpose it as a per-turn record; (C) drop it in a new migration.

**Decision:** (C). The ceiling is computed from `interviews.started_at` (stamped at
`modules/interview/profile.ts:112`) against `VOICE_MAX_ROUND_SECONDS` /
`VOICE_MAX_INTERVIEW_SECONDS` — the same two config values, read from the row that already
records when the interview began. Per the ADR-F02 migration rule this is a **new** migration
rebased on F02, never an edit to the init SQL.

**Why not (A):** an empty table with a foreign key is a question every future reader has to
answer by reading deleted code. **Why not (B):** there is nothing a turn record would be used
for. The transcript is the record of what happened, and it already exists.

**Consequences:** the migration drops `voice_sessions` and the `Interview.voice_sessions`
relation (`schema.prisma:267,359-369`). `backend/features/step_definitions/
answers.steps.ts:189` asserts `prisma.voiceSession.count(...) === 0` and must go with it. The
`expires_at`-based ceiling becomes an arithmetic check in `tts.ts` and `stt.ts` — see ADR-S06.

---

## ADR-S06 — 2026-08-06 — The client ends the turn; the server ends the interview

**Context:** the round (720 s) and interview (1500 s) ceilings are enforced today **inside**
`webhook-auth.ts:97` `isPastCeiling`, which ends the interview with
`ended_reason = 'time_exhausted'` — the only writer of that enum value in the codebase. ADR-S03
deletes that file. Separately, the new turn loop needs something to decide when the candidate
has stopped speaking. Options: (A) let the client's VAD also decide when time is up; (B) put a
countdown on the server and push it; (C) client VAD ends the *turn*; the server re-checks the
ceiling on every TTS and STT call and ends the *interview*.

**Decision:** (C). VAD stops the recording after ~2 s of silence, with a manual Stop always
visible (spec Open question 2). Independently, `tts.ts` and `stt.ts` each compute elapsed time
from `interviews.started_at` **before** calling the provider; past the ceiling they make no
provider call, return `VOICE_SESSION_EXPIRED`, and route
`applyTransition(evaluating, { endedReason: 'time_exhausted' })` — the same I07 edge the webhook
gate used.

**Why not (A):** a hung tab, a paused debugger or a modified client would run the interview past
its cap, and the cap is what bounds the spend. **Why not (B):** a pushed countdown is a second
source of truth for a number both sides can derive from `started_at`.

**Consequences:** S05's definition of done asserts the ceiling still fires **after** the webhook
is gone — that assertion is why S05 is opus-tier. `VOICE_MAX_ROUND_SECONDS` and
`VOICE_MAX_INTERVIEW_SECONDS` keep their only enforcement, avoiding the dead-config class issue
#117 already documents. `GET /state` gains `startedAt` and `expiresAt` so the room can render
the same number the server is enforcing (S09, issue #105).

---

## ADR-S07 — 2026-08-06 — Candidate audio is transient, and the pre-join copy must say so

**Context:** under convai the audio went browser→ElevenLabs directly and we never held it; the
pre-join screen tells the candidate nothing is recorded, and voice AC-13 asserts no recording
affordance exists. Under ADR-S02 the answer audio is now recorded by `MediaRecorder`, uploaded
to **our** server, and forwarded to the provider. That is a materially different privacy story
than the one currently on screen. Options: (A) store the audio (a re-listen feature, better
re-transcription); (B) hold it transiently in memory and discard after transcription, changing
the copy; (C) hold it transiently and leave the copy alone.

**Decision:** (B). The buffer lives in memory for the length of one request. It is never written
to object storage, never to a DB column, never logged. Only the transcript persists — the same
artifact a text answer produces. And the pre-join copy changes to say that the answer audio is
sent for transcription and not kept.

**Why not (A):** storing candidate voice recordings is a different product with different
consent, retention and deletion obligations, and this project has no KVKK/GDPR surface at all
yet (#61). **Why not (C):** the current copy would become false. A privacy claim a user acts on
is the one place where saying nothing and saying something untrue are the same act.

**Consequences:** `speech AC-14` asserts no object-storage key and no DB column holds audio for
a completed interview. The pre-join copy changes in both locales (S07). This does not build the
consent surface #61 tracks — it keeps this ledger from making that issue worse.
