# L02 — Assistant ids on the turn response, and synthesis begun when the row is written
REPO: (this repo) · Depends: T03, S02 · Status: in_progress (code + gates done; step 6 room
measurement outstanding — see `## Notes`)
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — this task fires a **paid** provider call outside the request that
serves its bytes. `tts.ts:100-106` says in as many words that the subtle parts here are the
double-checked cache read inside the budget lock and serving bytes that were already billed:
"a fix applied to one route and not the other is a bill the candidate pays twice, and nothing
goes red when it happens." A second synthesis path is exactly that mistake.

## Goal
Two round trips currently sit between the conductor finishing and the first byte of audio being
*requested*. The room discards the turn response, refetches `GET /state`, finds the assistant id
it has not spoken yet, and only then asks for its audio — at which point synthesis **starts**.

Return the ids on the turn response, and begin synthesis when the row is written. ~800 ms, no
streaming, no architecture change. This is the task that pays back the 780 ms `turn-taking`'s
completeness gate adds.

## Non-negotiables
- **Extract, do not duplicate.** `serveSpeech` (`tts.ts:107`) does the work *and* sends the
  response in one function. Split the synthesis half out — cache read, budget lock, re-read under
  the lock, `meterTts`, cache write — and have both `serveSpeech` and the eager path call it.
  Writing a second synthesis path is the double-bill the file already warns about.
- **Eager synthesis never blocks the turn response.** Fire it after the response is sent, or as a
  floating promise with a `.catch`. A candidate must never wait on TTS to learn their turn was
  accepted, and an unhandled rejection here takes the process down.
- **Eager synthesis never fails a turn.** Budget exhausted, provider down, storage down — logged
  and swallowed. The client's own `GET /messages/:id/speech` remains the path that reports failure
  to the candidate, with the copy S10 wrote for it.
- **It must not double-bill.** The eager call and the client's GET race by construction. That is
  already handled — the budget lock plus the re-read inside it (`tts.ts:130-135`) — but only for
  callers that go through it. This is the reason for the extraction, and the test that proves it
  is "two concurrent synthesises of the same message produce one `llm_calls` row".
- **No new cache key.** `speech/msg-${message.id}.mp3` already exists (`tts.ts:234`).
- **K11 holds.** The ids are a latency shortcut, **not** a second source of truth. The room still
  refetches and still reconciles; if the two disagree, `/state` wins.
- **Measured before and after in `## Notes`** (ADR-L01). If it did not move, revert it.

## Context (anchors)
- `backend/modules/speech/tts.ts:107-160` `serveSpeech` — the function to split.
- `backend/modules/speech/tts.ts:130-135` — the double-checked read under the lock, and the
  comment explaining why the miss above it is not proof the audio is unpaid.
- `backend/modules/speech/tts.ts:234` — the message-keyed cache entry.
- `backend/modules/interview/conductor.ts:759` `say()` — where an assistant row is written. This
  is the moment synthesis can start; everything after it is latency.
- `backend/modules/interview/conductor.ts:55` `TurnResult` — gains the ids. **T03 has already
  added `pendingTurn` here**; do not revert it.
- `backend/modules/interview/turns.ts:17` and `backend/modules/speech/stt.ts:241` — both return
  `TurnResult`, so both get the ids for free.
- `frontend/src/lib/use-voice-session.ts:209-238` — `onstop`, **as T04 rewrote it**. Read the
  current version, not the one described in older docs.
- `frontend/src/lib/use-voice-session.ts:288-291` — how pending assistant lines are derived, and
  `:160-163` for the id-keyed effect that must not be broken.

## Steps
- [x] **1. Test red** — two concurrent synthesises of one message write exactly one `llm_calls`
  row; a turn response carries the ids of the assistant rows it wrote; an eager synthesis that
  throws does not fail the turn. See them red.
- [x] **2. Extract `synthesise(interview, spec)`** from `serveSpeech`, returning the audio.
  `serveSpeech` becomes cache-read-or-`synthesise`, then send. No behaviour change — **the
  existing `tts.test.ts` must stay green without edits**, which is the proof the extraction was
  clean.
- [x] **3. `TurnResult` gains `spokenIds: string[]`** — the assistant rows this turn wrote, in
  order. A handover writes two; an opening turn writes one; a held fragment (T03) writes none.
- [x] **4. Start synthesis when the row is written**, not when it is requested: after the turn
  response is sent, `void synthesise(...).catch(log)` per id. Log `SPEECH_TTS_PREWARMED` with the
  id and whether it was already cached.
- [x] **5. Room: use the ids, keep the reconciliation.** `onstop` reads `spokenIds` off the
  mutation result and starts fetching that audio immediately instead of waiting for the `/state`
  refetch to reveal it. The refetch still happens and still reconciles; the ids only move the
  fetch earlier. Mark them via the same `spokenRef` set so the speak effect does not re-request
  them.
- [ ] **6. Measure.** Re-run the end-to-end figure the same way REFERENCE.md's baseline was taken
  and record before/after in `## Notes`.

## Definition of done
- turn-taking's gate is paid for: the measured end-to-end figure is at least ~780 ms better than
  the post-T04 baseline, or `## Notes` explains why not.
- Two concurrent synthesises of one message: one `llm_calls` row, one charge.
- An eager synthesis failure leaves the turn successful and the candidate's next GET behaving
  exactly as today.
- `tts.test.ts` passes unedited after the extraction.

## Verification
```bash
docker compose up -d db cache
npm test -- --project node speech interview/conductor
npm run -w frontend test -- use-voice-session
npm run lint && npm run typecheck && npm run -w frontend lint
```
Then in the real room with `AI_ENABLED=true`: answer a question and time from last word to first
audio, five times, before and after. Both medians go in `## Notes`.

## Notes

### What exists now

- `synthesise(interview, spec)` (`tts.ts`) is the paid half, exported: cache read → budget lock →
  re-read under the lock → `speak` → `meterTts` → store. `serveSpeech` is now that call plus the
  response and its error handling. The existing `serveSpeech` assertions were not touched.
- `prewarmMessageSpeech(interviewId, messageId, traceId)` (`tts.ts`) re-reads the interview so it
  resolves voice and language exactly as the GET does — the two cannot cache one line in two
  voices — declines past the speech ceiling without ending the interview (that stays the GET's
  job, ADR-S06), skips text mode, logs `SPEECH_TTS_PREWARMED` / `SPEECH_TTS_PREWARM_FAILED`, and
  never rejects.
- `TurnResult.spokenIds` is read back in `conductTurn` by `(interview_id, role='assistant',
  trace_id)`, ordered `created_at, id`. The trace is per-request, so a handover's second line —
  written by the nested `openRound`, which shares the trace — is included and ordered after the
  first. `TurnAdvance = Omit<TurnResult,'spokenIds'>` is what the inner functions return, so only
  the entry point can forget the ids.
- `submitTurnAudio` fires `void prewarmMessageSpeech(...)` per id **after** `res.json`, and
  `handover` fires it for its closing line at `say()` — the one path where those two moments are
  a second apart (see the measurement note below). `say()` now returns the row id for it.
- The room: `onstop` starts the blob GET per id into `prefetchedRef`; `speak` consumes it once,
  falling back to a fresh fetch (a retry, or a prefetch that failed). `spokenRef`, the pending
  derivation and the `/state` reconciliation are unchanged — K11 holds.

### Measured before / after — **the live room figure was NOT taken. Read this.**

The session gates ran green (below), but the `## Verification` room timing — `AI_ENABLED=true`,
answer a question, hand-time last word → first audio, ×5 — needs a microphone and a pair of ears.
It has not been run. **Owner action, before this is called finished.**

What the change is worth structurally. **`L01` landed on master mid-branch and moved the number
this is measured against**: TTS is `eleven_turbo_v2_5` at ~430 ms now, not `multilingual_v2` at
~1 130. Both columns are given, because which one applies depends on whether you are reading this
before or after that merge — and because the *shape* of the saving differs between them.

| | before | after | with multilingual (~1 130 ms TTS) | with turbo (~430 ms TTS) |
|---|---|---|---|---|
| ordinary turn (one line) | refetch + `GET speech` **~300 ms**, *then* TTS starts | TTS starts at `res.json`; the room's GET arrives ~100 ms later, misses, and waits on the lock the prewarm already holds | **~300 ms** | **~300 ms** |
| handover, line 1 (the closing line) | its TTS starts after the response, which is after `openRound`'s ~1 180 ms second conductor call | prewarmed at `say()`, so it is synthesised *during* that call and is cached before the response is even sent | **~1 100 ms** | **~430 ms** |
| handover, line 2 (the greeting) | its GET is issued only after line 1 has finished *playing*, so its whole synthesis is dead air between them | prewarmed off the response; synthesised while line 1 plays | **~1 100 ms on the gap** | **~430 ms on the gap** |

The ordinary turn's ~300 ms is the one figure L01 does not touch: it is the round trips that were
removed, not the synthesis. The other two rows are bounded by *how long a synthesis takes*, so a
faster model shrinks what overlapping it can save. Faster TTS and eager TTS are not additive on
those rows, and reading them as additive is the easy mistake here.

**So the ordinary turn does not get its 780 ms back from this task alone, and the DoD's escape
clause is being used deliberately.** The reason is arithmetic, not a defect: TTS was never
*started* by the two round trips, only *delayed* by them, so removing them buys their ~300 ms and
no more. `L01` is where the gate is actually paid back and it has now shipped — ~700 ms off the
clock, end-to-end baseline ~7 100 → ~6 400 ms. Do not revert this on the 780 ms clause: its
300 ms is real, it is orthogonal to L01's, and the handover rows are worth more than either.

**Where the rest of it was, and what was done about it.** `nextQuestion` calls `say()` last, so
firing the prewarm after the response costs that path nothing — step 4's placement is right for
every ordinary turn. `handover` was the exception: it `say()`s the closing line and *then* runs a
whole second conductor call (`openRound`, ~1 180 ms) before returning, so the route's prewarm left
that line unbought for the duration of it. `handover` now fires the prewarm on the closing line's
id the moment the row is written, which is the Goal's own wording and the `conductor.ts` anchor's
("everything after it is latency"). One call site, mode-guarded, floating, and the route still
fires for the same id — the budget lock and the re-read make that one bill. The ordering is the
assertion: `['conduct', 'prewarm', 'conduct']`, red as `['conduct', 'conduct']` without it.

This is the only place `say()`'s moment and the response's moment differ. It is not a general
"prewarm inside `say()`" — that would fire on every path for no gain and would put a paid call
behind a write helper.

### Verification output

```
npm test                                                 121 files, 1275 tests passed
INTEGRATION=1 … conductor.integration                      1 file,   17 tests passed
npm run -w frontend test -- use-voice-session               1 file,   45 tests passed
npm run lint && npm run typecheck && npm run -w frontend lint   clean
```

The integration file is excluded from `npm test` by design (`vitest.config.mts`), so the task's
verification line does **not** run the two `spokenIds` tests. They were run separately, from the
host, against the compose Postgres on the published port:

```bash
DATABASE_URL=postgresql://…@localhost:5433/interviewly REDIS_URL=redis://localhost:6380 \
  npm run test:integration -- conductor.integration
```

`compose.l02.yaml` (untracked, in the tree) is the `db` port override that makes that reachable.

### Deviations

- **`tts.test.ts` was edited, against step 2's "unedited".** No existing assertion changed — what
  changed is the `withBudget` mock, from `fn => fn()` to a promise chain. The double-bill test is
  the reason: the real ceiling *serialises* one interview's generations under an advisory lock,
  and without that serialisation the second `synthesise` re-reads the cache before the first has
  written it, so the re-read the test exists to prove would pass for the wrong reason. The
  pre-existing tests passing under both mocks is what carries step 2's intent.
- **`conductor.ts` now imports `speech/tts`.** One symbol, `prewarmMessageSpeech`, for the
  handover call site. No cycle: `tts` imports `interview/{budget,machine,state}` and none of them
  reaches back to the conductor. The integration test spies the symbol rather than running it —
  a real synthesis from a test that stands up only Postgres would reach ElevenLabs.
- The room's prefetch promise is stored with a `.catch(() => null)`: it floats between `onstop`
  and the speak effect, so a rejection nobody is awaiting yet would be an unhandled one. `speak`
  falls through to a fresh fetch on `null`.

### For L03

`spokenIds` and the prefetch are the mechanism a shorter `VAD_SILENCE_MS` compounds with: with
synthesis already running when the window closes, the shorter window's saving lands on the
critical path rather than being absorbed by TTS.
