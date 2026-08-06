# S03 — STT route: audio upload to Scribe to the guarded advance
REPO: (this repo) · Depends: S01, I03, I06 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — multer limits copied verbatim from `uploads.ts`, then the
**existing** `answerInputSchema` and `advanceWithAnswer`. The correctness that matters is
refusing to add a second answer path, which the non-negotiables state outright.
Independent of S02 — both depend on S01, neither on the other.

## Goal
Owner's ask:

> "Aday sesli cevap versin, sistem yazıya çevirsin."
> — IDEA.md §3.2, speech spec *Answer audio (STT)*

Ships `POST /interviews/:id/answers/audio`: the browser uploads one recorded answer, the backend
transcribes it with ElevenLabs Scribe, and the transcript goes through the **same** guarded
advance a typed answer uses.

## Security boundaries
- **Candidate audio is transient (ADR-S07).** Memory buffer for the length of one request, sent
  to the provider, discarded. Never `storage.put`, never a DB column, never a log line. speech
  AC-14 asserts a completed interview holds no audio anywhere.
- **The transcript is untrusted input.** It reaches `advanceWithAnswer` only through
  `answerInputSchema.safeParse` — the same parse the retired webhook did at
  `modules/voice/webhook-router.ts:73-78`, and for the same reason: a provider is not an
  authority on length or shape.
- **`requirePublicOrigin` applies.** Unlike the retired webhook this is a browser request with a
  cookie, so it is CSRF-relevant (I05).

## Non-negotiables
- **No second answer path.** `advanceWithAnswer` persists the row, advances the index, and runs
  the adaptive hook. This route transcribes and delegates. If something is missing from the
  answer flow, it is missing from `POST /answers` too and belongs in I06, not here.
- **`inputMode: 'voice'`** on every answer this route creates. That is what makes a downgraded
  interview legible afterwards: earlier answers `voice`, later ones `text`.
- **The ceiling is checked before the provider is called** — same rule and same transition as
  S02 (ADR-S06). An answer that arrives past the ceiling ends the interview; it is not billed
  and not transcribed.
- **A provider failure changes nothing.** No answer row, no index advance, no state change — the
  room re-records or the candidate types.

## Context (anchors)
- `backend/modules/speech/stt.ts` — **create.** The handler.
- `backend/modules/speech/router.ts` — mount it beside the S02 route.
- `backend/modules/interview/uploads.ts:37-39,44-47` — the multer memory-storage limits and the
  "multer's own limit stays as the backstop for a client that lies about its length" note.
  Copy the shape; the mime allow-list becomes audio types.
- `backend/modules/interview/answers.ts:31,40,166` — `answerInputSchema`, `advanceWithAnswer`,
  and how `submitAnswer` parses then delegates. This route is that handler with a transcription
  step in front.
- `backend/modules/interview/state.ts` — `currentQuestionRow`, for the `questionId` the schema
  needs.
- `backend/src/lib/error-codes.ts` — `SPEECH_AUDIO_INVALID`, `SPEECH_TRANSCRIPTION_FAILED`
  (added in S01).

## Steps
- [ ] **1. Feature scenarios red** — speech AC-3 (an upload persists `input_mode='voice'` and
  advances), AC-4 (oversize, wrong mime, undecodable — each changes nothing), AC-6 (past the
  ceiling: no provider call), AC-14 (no audio persisted). See them red.
- [ ] **2. multer** — memory storage, one part named `audio`, size limit from config, audio mime
  allow-list. `MulterError` maps to `UPLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` the way
  `uploads.ts:47` already does.
- [ ] **3. Guards** — `requireAuth`, `requirePublicOrigin`, ownership, voice-capable state,
  ceiling.
- [ ] **4. Transcribe** — `transcribe(buffer, { mime, language: interview.language })`. Pass the
  language explicitly (spec Open question 1): auto-detect on a Turkish answer to an English
  question is the failure #149 and I10 already document.
- [ ] **5. Delegate** — build `{ questionId, transcript, inputMode: 'voice' }`,
  `answerInputSchema.safeParse`, `advanceWithAnswer`. Respond with its `{ state, nextIndex }`.
- [ ] **6. Discard** — no reference to the buffer survives the handler. Log
  `SPEECH_STT_TRANSCRIBED` with `interviewId`, `traceId` and the duration in seconds — **not**
  the transcript.
- [ ] **7. Unit test** — an empty transcript yields `SPEECH_TRANSCRIPTION_FAILED` and no answer
  row; a successful upload yields exactly one answer row with `input_mode='voice'`.

## Definition of done
- speech AC-3, AC-4, AC-6 and AC-14 green.
- Exactly one code path creates answers, and it is I06's.
- No object-storage key and no DB column holds audio after a completed voice interview.
- No log line contains transcript text.

## Verification
```bash
npm test -- --project node speech/stt
npm run test:acceptance -- --tags "@speech"
psql "$DATABASE_URL" -c "SELECT input_mode, count(*) FROM answers GROUP BY input_mode;"
```
Expected: tests green; the answers table shows `voice` rows from the upload path and nothing
else new.

## Notes
