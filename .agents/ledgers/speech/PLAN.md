# Speech — PLAN (Architecture)

Written once. Amend only via a new `DECISIONS.md` ADR-S entry referenced here.
Codebase orientation: `REFERENCE.md` (read that before touching any task).
Spec: `.agents/specs/2026-08-06-speech.md`, which supersedes `2026-07-29-voice.md`.

## Goal

When this ships, an interview can actually be run in voice mode. The backend speaks each
question by calling ElevenLabs text-to-speech and streaming the bytes to the room; the room
records the answer, stops on silence, and uploads it; the backend transcribes it with
ElevenLabs Scribe and hands the text to the **existing** I06 guarded advance. The browser never
talks to ElevenLabs, so the API key never leaves the server and the CSP never relaxes. Every
provider call is metered into `spent_usd` at the call site. Any speech failure downgrades the
same interview to text with no data loss. `speech_turn.feature` and `speech_fallback.feature`
green, with `voice_session` / `voice_webhook` / `voice_reconciliation` deleted, is the
observable end-to-end result.

This replaces the V01–V05 Conversational-AI architecture wholesale. That build assumed an
ElevenLabs *agent* driving the turn and calling us back over authenticated webhooks. The owner's
decision is that ElevenLabs is used **for voice generation only** — no agent, no tools, no
webhooks, no public tunnel.

## The invariant this initiative must not weaken

> The candidate never depends on the speech layer: any speech failure continues the *same*
> interview in text, same `interviewId`, same index, with every recorded answer intact — and no
> provider call is ever made from the browser. (K3, §3.2, §3.8)

The voice ledger's invariant was about an untrusted ingress. This one has no ingress: deleting
`/webhooks/elevenlabs/*` removes the project's widest trust boundary rather than defending it.
What remains to protect is the *ceiling* and the *key*, both of which the webhook gate used to
carry and neither of which may fall on the floor during the swap.

This ledger **consumes** the K2 state machine, answer persistence and the budget transaction
rather than reimplementing them. It does not touch the transition table (I07), the guarded
advance (I06), or the `spent_usd`/`llm_calls` transaction shape (I08/K13).

## Topology

```
Browser ── same-origin only ──▶ edge/ (Caddy) ──▶ backend/src/app.ts
   │  GET  /interviews/:id/questions/:index/speech   (audio/mpeg out)
   │  POST /interviews/:id/answers/audio             (multipart in)
   │
   │  no WSS. no cross-origin request. CSP stays connect-src 'self'.
   ▼
backend/modules/speech/
   ├── SpeechProvider.ts     ← the K3 seam: speak() + transcribe()
   ├── elevenlabs-speech.ts  ← real driver: /v1/text-to-speech/:voiceId, /v1/speech-to-text
   ├── fake-speech.ts        ← FakeSpeechProvider (failNext), the acceptance seam §5.5
   ├── tts.ts                ← question audio; storage-cached; ceiling-checked; meters characters
   ├── stt.ts                ← answer audio; multer memory; meters seconds; calls I06
   └── router.ts             ← mounts both under /interviews
                                          │
   modules/voice/downgrade.ts  ← KEPT: voice → text, consumes the I07 transition
   modules/interview/          ← CONSUMED, not modified
        answers.ts (I06)       ← advanceWithAnswer persists the transcribed answer
        machine.ts (I07)       ← time_exhausted + downgrade route here
        budget.ts (I08)        ← withBudget wraps every provider call
   src/lib/storage.ts (I11/I12) ← put/get the cached question audio
   src/lib/db.ts               ← recordLlmCall, the metering row

   Postgres ← answers.input_mode='voice', llm_calls, interviews.mode/spent_usd/ended_reason/started_at
   Redis    ← unchanged (no speech queue; nothing is deferred)

DELETED: modules/voice/{VoiceSession,elevenlabs-session,fake-session,webhook-auth,
         webhook-router,reconcile-webhook,reconcile}.ts · worker/src/jobs/voice-reconcile.ts
         · the voice.reconcile queue · compose.dev.yaml's cloudflared tunnel · voice_sessions
```

## Decision table (full ADRs in DECISIONS.md)

| # | Decision | Chosen | Reason |
|---|----------|--------|--------|
| ADR-S01 | Provider role | ElevenLabs is TTS + STT behind a `SpeechProvider` seam; no convai agent | Owner's decision. The agent architecture required tools, webhooks and a public tunnel to deliver an answer path we can build with two ordinary HTTP calls |
| ADR-S02 | Where the provider is called | Server-side, both directions | The key never reaches the browser, so CSP stays `connect-src 'self'` and issue #57 is retired rather than configured |
| ADR-S03 | The webhook trust boundary | Deleted, not disabled | Four gates whose absence must be justified once, in writing, rather than left as dead code that reads like a live defence |
| ADR-S04 | Usage accounting | Per-call `llm_calls` write at the TTS/STT call site, inside I08's transaction | A synchronous call that returns bytes is billed in the request that made it; reconciliation existed only because the webhook was async and redeliverable |
| ADR-S05 | `voice_sessions` | Dropped, in a new migration | No mint, no nonce, no webhook — the table has no reader and no writer. The ceiling reads `interviews.started_at` |
| ADR-S06 | Turn end | Client VAD, server ceiling | The client decides when the candidate stopped talking; only the server decides when time is up |
| ADR-S07 | Candidate audio | Transient — memory, provider, discarded | Answer audio now leaves the browser, which the old design never did. It is never stored, and the pre-join copy must say what happens to it |

## Data model additions

**One structural change: `voice_sessions` is dropped** (ADR-S05), in its own migration rebased
on F02 — never an edit to F02's init SQL. Everything else is columns F02 already shipped.

| Table | Speech reads | Speech writes |
|---|---|---|
| `interviews` | `state`, `mode`, `language`, `current_index`, `started_at`, `spent_usd`, `budget_usd` | `mode='text'` on downgrade; `ended_reason='time_exhausted'` on ceiling; `spent_usd` (I08 tx) |
| `personas` | `voice_id` — the ElevenLabs voice, already seeded | — |
| `questions` | `text` to speak, `id` as the audio cache key | — |
| `answers` | — | `INSERT` `input_mode='voice'` via the I06 guarded advance |
| `llm_calls` | — | `INSERT` `provider='elevenlabs'`, `model='tts'`/`'stt'`, `unit_kind='character'`/`'second'` |

`UnitKind` already contains both `character` and `second`. No enum migration.

## The turn loop (this ledger's core mechanic)

```
1. speak      GET  /interviews/:id/questions/:index/speech  → audio/mpeg
              cache hit  → no provider call
              cache miss → withBudget → speak() → llm_calls(character) → storage.put
2. listen     MediaRecorder on the mic; VAD on the existing AnalyserNode RMS
              stops on ~2 s of silence; a manual Stop is always visible
3. transcribe POST /interviews/:id/answers/audio  (multipart, one part)
              withBudget → transcribe() → llm_calls(second) → answerInputSchema → advanceWithAnswer
4. advance    refetch GET /interviews/:id/state; the server's index is the only index
```

Every server step re-checks the ceiling against `interviews.started_at` **before** calling the
provider. The client's VAD is a convenience; it is never the enforcement. Steps 1 and 3 are
independently refusable and independently downgradeable — a failure in either continues the
interview in text rather than ending it.

## Phasing / task clusters (see STATE.md ledger)

0. Seam + config (S01) — `SpeechProvider`, `FakeSpeechProvider`, env and error-code rewrite
1. The two routes (S02 TTS, S03 STT) — independent of each other, both on S01
2. Money (S04) — per-call `llm_calls` + `spent_usd` at both call sites
3. Removal (S05) — the convai/webhook/reconciliation surface and `voice_sessions`, **last**
4. The room (S06) — the turn loop, wiring the three orphan modules
5. The surviving UX issues (S07–S10) — pre-join/resume, voice-first + duration, timer, error copy

**S05 deletes only after S02–S04 replace.** Deleting first leaves the repo with no voice path
for several sessions and the acceptance ring red for a reason nobody can distinguish from a
regression.

## Out of scope (post-speech)

- **The K2 state machine, the guarded advance, the `spent_usd`/`llm_calls` transaction shape** —
  `interview-core` (I06, I07, I08). Consumed, never reimplemented.
- **Streaming TTS, partial transcripts, barge-in.** The loop is discrete. Streaming is an
  optimisation of a thing that works, and nothing works yet.
- **Rotating and purging the committed `ELEVENLABS_API_KEY`** (`.env:39`) — owner action,
  tracked as its own issue. This ledger cannot rotate a key.
- **The KVKK/GDPR surface** (#61). ADR-S07 changes what the pre-join copy must *say*; it does
  not build the consent, policy or deletion surface that issue tracks.
- **Prompt building, occupation/language logic, price-table shape** — `ai` (K9, K15).
- **The room shell, React Query data layer, i18n plumbing** — `frontend` (K11). This ledger
  supplies the turn loop and the signals; `frontend` owns composition.
- **`security.feature`** — `interview-core`'s. This ledger owns `speech_turn` and
  `speech_fallback` only.

**The entire schema lives in F02. This ledger drops one table in its own migration and adds
nothing. Any further structural change is a change to F02's scope and gets discussed, not
merged.**
