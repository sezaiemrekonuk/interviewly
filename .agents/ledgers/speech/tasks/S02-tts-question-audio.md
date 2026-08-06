# S02 — TTS route: question audio, storage-cached, ceiling-checked
REPO: (this repo) · Depends: S01, I03, I07 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — a GET that returns bytes, with ownership and state guards copied
from the existing mint handler and a cache read/write over `storage.put`/`get`. The ceiling
arithmetic is mechanical here; S05 is where its survival is proven.
Independent of S03 — both depend on S01, neither on the other.

## Goal
Owner's ask:

> "Mülakatı soran taraf sesli olsun."
> — IDEA.md §3.2, speech spec *Question audio (TTS)*

Ships `GET /interviews/:id/questions/:index/speech`: the current question's text spoken in the
round persona's voice, streamed as `audio/mpeg` from our own origin, cached so a reload or a
replay costs nothing.

## Security boundaries
- **Owner only, current question only.** The guards are the same set the retired mint used
  (`modules/voice/session.ts:46-60`): ownership via I03, a voice-capable state, and the index
  matching `interviews.current_index`. A route that speaks any question by index is a way to
  read the whole question set before answering it.
- **The response is bytes.** No JSON envelope, no provider URL, no key, no cache key in a
  header.

## Non-negotiables
- **The ceiling is checked before the provider is called**, not after. Past it: no provider
  call, `applyTransition(interview, 'evaluating', { endedReason: 'time_exhausted' })`,
  `VOICE_SESSION_EXPIRED`. This is the duty moving out of `webhook-auth.ts:97` (ADR-S06) — S05
  deletes the original and asserts this one fires.
- **A cache hit makes no provider call and bills nothing.** Question audio is immutable: the
  text does not change once the question exists.
- **`voiceId` comes from the round's persona**, not from config and not from a request field.
- **Metering is S04's.** Write the route so the provider call is already wrapped in a single
  place S04 can put `withBudget` and `recordLlmCall` around. Do not pre-empt it, and do not make
  it hard to add.

## Context (anchors)
- `backend/modules/speech/tts.ts` — **create.** The handler.
- `backend/modules/speech/router.ts` — **create.** Mounts under `/interviews`, alongside the
  existing `voiceRouter` at `backend/src/app.ts:58`.
- `backend/modules/voice/session.ts:19,46-60` — `VOICE_CAPABLE_STATES` and the ownership/state
  guard shape to copy. The file is deleted in S05; copy the shape now, do not import from it.
- `backend/modules/interview/state.ts` — `currentQuestionRow` / `resolvePersonas`: the question
  text and the round persona.
- `backend/src/lib/storage.ts:15-19` — `put(key, bytes, mime)` / `get(key)`. Cache key
  `speech/{questionId}.mp3`. A `get` that throws is a miss, not an error.
- `backend/modules/interview/profile.ts:112` — where `started_at` is stamped, for the ceiling.
- `backend/modules/interview/machine.ts` — `applyTransition`, the only writer of state.

## Steps
- [x] **1. Feature scenarios red** — speech AC-1 (owner gets audio, non-owner `FORBIDDEN`,
  no key in the payload), AC-2 (second request makes no provider call), AC-6 (past the ceiling:
  no provider call, `time_exhausted`). Append to `speech_turn.feature`; see them red.
- [x] **2. Route + guards** — `requireAuth`, ownership, voice-capable state, index equals
  `current_index`.
- [x] **3. Ceiling check** — elapsed from `interviews.started_at` against
  `VOICE_MAX_ROUND_SECONDS` / `VOICE_MAX_INTERVIEW_SECONDS`; past it, transition and refuse.
- [x] **4. Cache read** — `storage.get('speech/{questionId}.mp3')`; on hit, respond and log
  `SPEECH_TTS_SERVED` with `cached: true`.
- [x] **5. Cache miss** — `speak(question.text, { voiceId: persona.voice_id, language })`,
  `storage.put`, respond, log `SPEECH_TTS_SERVED` with `cached: false` and the character count.
- [x] **6. Failure path** — a `VOICE_UNAVAILABLE` from the seam downgrades to text through
  `downgradeToText` (V03, kept) and then returns 503, exactly as the retired mint did at
  `modules/voice/session.ts:81-82`.
- [x] **7. Unit test** — cache hit calls the provider zero times; a past-ceiling request calls it
  zero times and leaves `ended_reason = 'time_exhausted'`.

## Definition of done
- speech AC-1, AC-2 and AC-6 green.
- A replayed question serves from storage with no second provider call.
- A past-ceiling request ends the interview and never reaches ElevenLabs.
- The response carries `audio/mpeg` bytes and nothing else.

## Verification
```bash
npm test -- --project node speech/tts
npm run test:acceptance -- --tags "@speech"
psql "$DATABASE_URL" -c "SELECT ended_reason FROM interviews WHERE id = '<past-ceiling id>';"
```
Expected: tests green; the past-ceiling interview reads `time_exhausted`.

## Notes
- Added `backend/modules/speech/tts.ts` and `backend/modules/speech/router.ts`.
- Mounted speech router at `/interviews` in `backend/src/app.ts`.
- Added unit tests in `backend/modules/speech/tts.test.ts` for cache-hit no-provider and ceiling transition (`VOICE_SESSION_EXPIRED` + `time_exhausted`).
- Extended fake provider counters in `backend/modules/speech/fake-speech.ts` for AC-2 assertions.
- Extended speech acceptance scenarios + steps in `.agents/features/speech_turn.feature` and `backend/features/step_definitions/speech.steps.ts`.
- Verification ran green:
  - `npm test -- --project node speech/tts`
  - `REDIS_URL=redis://127.0.0.1:16380 DATABASE_URL=postgresql://interviewly:interviewly@127.0.0.1:15432/interviewly npm run test:acceptance -- --tags "@speech"`
  - `psql "postgresql://interviewly:interviewly@127.0.0.1:15432/interviewly" -c "SELECT ended_reason FROM interviews WHERE id = 'cmshq5ykt000si1q0xqmjntb0';"` => `time_exhausted`
- Local env caveat: host `5432/6380` can collide with native services. Used compose override ports `15432/16380` for reliable acceptance run.
