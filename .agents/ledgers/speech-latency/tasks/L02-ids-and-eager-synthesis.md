# L02 — Assistant ids on the turn response, and synthesis begun when the row is written
REPO: (this repo) · Depends: T03, S02 · Status: todo
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
- [ ] **1. Test red** — two concurrent synthesises of one message write exactly one `llm_calls`
  row; a turn response carries the ids of the assistant rows it wrote; an eager synthesis that
  throws does not fail the turn. See them red.
- [ ] **2. Extract `synthesise(interview, spec)`** from `serveSpeech`, returning the audio.
  `serveSpeech` becomes cache-read-or-`synthesise`, then send. No behaviour change — **the
  existing `tts.test.ts` must stay green without edits**, which is the proof the extraction was
  clean.
- [ ] **3. `TurnResult` gains `spokenIds: string[]`** — the assistant rows this turn wrote, in
  order. A handover writes two; an opening turn writes one; a held fragment (T03) writes none.
- [ ] **4. Start synthesis when the row is written**, not when it is requested: after the turn
  response is sent, `void synthesise(...).catch(log)` per id. Log `SPEECH_TTS_PREWARMED` with the
  id and whether it was already cached.
- [ ] **5. Room: use the ids, keep the reconciliation.** `onstop` reads `spokenIds` off the
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
_(fill in when done — the measured before/after is the point of the task)_
