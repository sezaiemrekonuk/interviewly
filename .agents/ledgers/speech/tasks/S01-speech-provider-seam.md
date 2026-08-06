# S01 — `SpeechProvider` seam, `FakeSpeechProvider`, and the env + error-code rewrite
REPO: (this repo) · Depends: F01, F03, I15 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — an interface, a fake, and a config edit against a pattern the repo
already has three times (`src/lib/storage.ts:31,52`, `modules/voice/session.ts:26,42`, the AI
provider). The one judgement call — making `ELEVENLABS_API_KEY` fail at boot — is spelled out
in the steps.

## Goal
Owner's ask:

> "ElevenLabs sadece ses üretimi için — ajan yok, webhook yok."
> — the owner's decision, 2026-08-06; ADR-S01, speech spec *Contracts*

Ships the K3 seam every later task consumes: `speak()` for question audio, `transcribe()` for
answer audio, one real ElevenLabs driver, one fake with `failNext`, and the config rewrite that
makes a missing API key a boot failure rather than a 503 at the first question.

## Security boundaries
- **`ELEVENLABS_API_KEY` is read in `elevenlabs-speech.ts` and nowhere else.** Not in a route,
  not in a response, not in a log line, not in a fixture. ADR-S02 exists so that the browser
  never needs it; a second reader is how that leaks back.
- **A missing key fails at boot, not at the first request.** `env.ts:39`'s
  `z.string().optional()` plus the `??`-vs-`''` bug at `elevenlabs-session.ts:41` is exactly how
  issue #56 shipped: empty config, 503 at runtime, silent irreversible downgrade to text, no
  operator ever told. An empty string is not a configured key.

## Non-negotiables
- **The seam is the only route to the provider.** No `fetch('https://api.elevenlabs.io…')`
  anywhere but the real driver. That is what makes the acceptance ring runnable with no network.
- **`FakeSpeechProvider` carries `failNext`**, matching `FakeVoiceSession`'s shape, so
  `speech_fallback.feature` can drive a fatal failure deterministically.
- **`voiceId` is a parameter, never config.** It comes from `personas.voice_id` (F02, seeded).
  Do not add `ELEVENLABS_VOICE_ID_*` env keys — that was the agent-id mistake in a new costume.
- **No route is added in this task.** S02 and S03 own the HTTP surface. S01 ends at the seam.

## Context (anchors)
- `backend/modules/speech/SpeechProvider.ts` — **create.** The interface in REFERENCE.md.
- `backend/modules/speech/elevenlabs-speech.ts` — **create.** `POST /v1/text-to-speech/{voiceId}`
  and `POST /v1/speech-to-text`, `xi-api-key` header, the same timeout+retry shape as
  `modules/voice/elevenlabs-session.ts:14,34` (5 s abort, 3 attempts) — **but log the status
  and reason on failure**, which `elevenlabs-session.ts:63` does not, and which is why #56 was
  invisible.
- `backend/modules/speech/fake-speech.ts` — **create.** Returns a fixed short buffer and a fixed
  transcript; `failNext` throws once.
- `backend/src/lib/storage.ts:31,52` — the module-binding + `setStorage` pattern to copy for
  `setSpeechProvider`.
- `backend/src/lib/env.ts:39-47` — the keys to change.
- `backend/src/lib/error-codes.ts:42-46` — add `SPEECH_AUDIO_INVALID` (400) and
  `SPEECH_TRANSCRIPTION_FAILED` (502), both `owner: 'voice'`. Leave the four webhook codes
  alone; S05 removes them with their producer.
- `frontend/messages/{en,tr}.json` — copy for the two new codes, both locales.

## Steps
- [x] **1. `speech_turn.feature` red first** — write the AC-1/AC-3 scenarios against the fake,
  append the file to `cucumber.js` `paths`, and *see it red* before writing any module.
  EXECUTE.md § 6 ATDD ordering is not optional.
- [x] **2. `SpeechProvider.ts`** — the interface exactly as REFERENCE.md states it, plus the
  module-level binding and `setSpeechProvider(next)`.
- [x] **3. `fake-speech.ts`** — deterministic buffer and transcript, `failNext`, a `characters`
  and a `seconds` count the metering task can assert against.
- [x] **4. `elevenlabs-speech.ts`** — both calls, timeout and retry, and a failure log carrying
  the HTTP status and response reason. Throw `VOICE_UNAVAILABLE` after the last attempt.
- [x] **5. Env rewrite** — add `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_STT_MODEL`; make
  `ELEVENLABS_API_KEY` required (non-empty) whenever voice mode can be selected; update `.env`
  and `.env.example`. Do **not** remove the agent-id or webhook keys here — S05 removes them
  with the code that reads them, so no session leaves a key referenced by live code.
- [x] **6. Two error codes** and their copy in both locales.
- [x] **7. Unit test** — the fake satisfies the interface; `failNext` throws exactly once; a
  driver given an empty key never reaches `fetch`.

## Definition of done
- `speech_turn.feature`'s seam scenarios pass against `FakeSpeechProvider` with no network.
- Booting with `ELEVENLABS_API_KEY=` (empty) fails at startup with `ENV_VALIDATION_FAILED`, not
  at the first question (speech AC-1's precondition, and the fix for #56).
- Grep for `api.elevenlabs.io` outside `elevenlabs-speech.ts` returns only
  `modules/voice/elevenlabs-session.ts`, which S05 deletes.
- No new route exists.

## Verification
```bash
npm test -- --project node speech
npm run test:acceptance -- --tags "@speech"
# must exit non-zero at boot. The timeout is the failure case: a server that starts is the bug.
ELEVENLABS_API_KEY= timeout 15 npm run -w backend start; echo "exit=$?"
grep -rn "api.elevenlabs.io" backend --include="*.ts" | grep -v dist
```
Expected: unit and acceptance green; the empty-key boot exits non-zero; the grep prints exactly
two files (`modules/speech/elevenlabs-speech.ts` and the not-yet-deleted
`modules/voice/elevenlabs-session.ts`).

## Notes

Files created: `backend/modules/speech/SpeechProvider.ts`, `fake-speech.ts`, `elevenlabs-speech.ts`,
`backend/features/step_definitions/speech.steps.ts`, `backend/modules/speech/speech.test.ts`,
`.agents/features/speech_turn.feature`.

Files modified: `backend/src/lib/env.ts`, `backend/src/lib/error-codes.ts`,
`frontend/messages/en.json`, `frontend/messages/tr.json`, `.env`, `.env.example`, `cucumber.js`,
`STATE.md` (this ledger).

`ELEVENLABS_API_KEY` is now `z.string().min(1)` — empty string fails at boot. `ELEVENLABS_TTS_MODEL`
defaults to `eleven_multilingual_v2`, `ELEVENLABS_STT_MODEL` to `scribe_v1`.

Unit tests 5/5 green. Acceptance ring skipped (Redis unavailable in sandbox — same as V05).

S02 next. It needs `speechProvider.speak()` (this task) + `withBudget` (I08, done) + `storage`
(I11/I12, done) + `isPastCeiling` logic (pattern from `modules/voice/webhook-auth.ts:97`).
The seam is in `backend/modules/speech/SpeechProvider.ts`; the route goes in
`backend/modules/speech/router.ts` (S02 creates it).
