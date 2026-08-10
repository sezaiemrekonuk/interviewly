# Speech — REFERENCE (read this once, then you don't need to spelunk)

Reflects the repo as of **2026-08-07**, through S05. Written against the code,
not against the voice ledger's REFERENCE — that one describes the convai architecture this
ledger replaces, and is now historical.

If reality diverges, trust the code and patch this file.

## Services, ports, roles

| Service | Package | Port (internal) | DB role | Trust |
|---|---|---|---|---|
| edge | `edge/` (Caddy) | 80 | — | public; the only published port |
| api | `backend/` | 3001 | read/write | session cookie + CSRF origin |
| frontend | `frontend/` | 3000 | — | sets the CSP (`src/middleware.ts`) |
| worker | `worker/` | — | read/write | no ingress |
| db | Postgres | 5432 | — | compose network only |
| cache | Redis | 6379 | — | compose network only |
| ElevenLabs | external | — | — | **outbound only.** Never calls us; never called from a browser |

There is no tunnel — S05 deleted `compose.dev.yaml`'s `cloudflared` service with the webhook
it existed for.

## Commands

```bash
# services
docker compose up -d db cache

# backend
cd backend && npm install && npx prisma migrate deploy && npm run seed

# unit — one vitest run over the whole tree (vitest.config.mts defines the projects).
# `backend` has NO `test` script: its tests belong to the root `node` project.
npm test
npm test -- --project node speech          # backend/packages, filtered
npm run -w frontend test -- room           # frontend has its own runner script

# acceptance — the default profile carries the speech features
npm run test:acceptance
npm run test:acceptance -- --tags "@speech"

# gates, in this order, before claiming done
npm run lint && npm run typecheck && npm test
```

`npm run test:acceptance` needs Docker (`db` + `cache`). If Docker is unavailable in your
sandbox, say so explicitly in the devlog rather than reporting a skipped ring as green — V05's
devlog is the precedent for how to record that honestly.

## HTTP contracts (speech surface)

| Method | Path | Auth | In | Out | Errors |
|---|---|---|---|---|---|
| GET | `/interviews/:id/questions/:index/speech` | `requireAuth`, owner | — | `audio/mpeg` bytes | `FORBIDDEN`, `QUESTION_NOT_CURRENT`, `INVALID_STATE_TRANSITION`, `VOICE_SESSION_EXPIRED`, `VOICE_UNAVAILABLE` |
| POST | `/interviews/:id/answers/audio` | `requireAuth`, `requirePublicOrigin`, owner | multipart, one `audio` part | `{ state, nextIndex }` | `UPLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `SPEECH_AUDIO_INVALID`, `SPEECH_TRANSCRIPTION_FAILED`, + the above |
| POST | `/interviews/:id/voice/downgrade` | `requireAuth`, `requirePublicOrigin`, owner | `{}` | `{}` (200) | `INTERVIEW_NOT_FOUND`, `FORBIDDEN` |

The third one already exists and is untouched by this ledger (`modules/voice/session.ts:116`).

Retired by S05: `POST /interviews/:id/voice/session`, `POST /webhooks/elevenlabs/:action`,
`POST /webhooks/elevenlabs/post_call`.

## The `SpeechProvider` seam (S01)

```ts
export interface SpeechProvider {
  speak(text: string, opts: { voiceId: string; language: string }):
    Promise<{ audio: Buffer; mime: string; characters: number }>;
  transcribe(audio: Buffer, opts: { mime: string; language: string }):
    Promise<{ transcript: string; seconds: number }>;
}
```

Module-level binding + `setSpeechProvider(next)`, exactly like `src/lib/storage.ts:31,52`. The
acceptance ring replaces it in a `Before` hook. `FakeSpeechProvider` carries `failNext` so
`speech_fallback.feature` can drive a fatal failure with no network — the `FakeVoiceSession`
pattern, kept.

Provider endpoints (real driver only): `POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}`
and `POST https://api.elevenlabs.io/v1/speech-to-text`, both with the `xi-api-key` header.

## The ceiling (the thing that must not be lost)

```
elapsed        = now - interviews.started_at            (started_at stamped at modules/interview/profile.ts:112)
roundLeft      = VOICE_MAX_ROUND_SECONDS    - elapsedInRound
interviewLeft  = VOICE_MAX_INTERVIEW_SECONDS - elapsed
past ceiling  → NO provider call
              → applyTransition(interview, 'evaluating', { endedReason: 'time_exhausted' })
              → VOICE_SESSION_EXPIRED (403)
```

`isPastSpeechCeiling` (`modules/speech/ceiling.ts`, re-exported from `tts.ts`) is the whole
enforcement, called by `serveQuestionSpeech` and by `guardVoiceAnswer` (`stt.ts`) before either
reaches the provider. S05 deleted `webhook-auth.ts`'s original; `speech_turn.feature` @AC-6 is
what holds it. S09 split out `speechExpiresAt` — the same instant, which `GET /state` reports as
`expiresAt` so the room's countdown cannot disagree with the 403 (ADR-S09).

## Key code anchors

| Path | What lives there |
|---|---|
| `backend/modules/speech/` | **created by this ledger** — seam, driver, fake, `ceiling.ts`, `tts.ts`, `stt.ts`, `router.ts` |
| `backend/modules/interview/answers.ts:31,40` | `answerInputSchema` (accepts `inputMode: 'voice'`) and `advanceWithAnswer` — the STT route's only way in |
| `backend/modules/interview/machine.ts` | `applyTransition`, sole writer of `interviews.state` |
| `backend/modules/interview/budget.ts:37` | `withBudget(interviewId, fn)` — wraps every provider call |
| `backend/modules/interview/uploads.ts:37-39` | multer memory-storage limits to copy for the audio part |
| `backend/modules/interview/profile.ts:112` | where `started_at` is stamped |
| `backend/modules/interview/state.ts` | the `/state` payload; `interviewWindow` is S09's `startedAt`/`expiresAt` |
| `backend/modules/voice/downgrade.ts` | `downgradeToText`, `preJoinDowngrade` + `POST /:id/voice/downgrade` — the only voice module left after S05 |
| `backend/src/lib/storage.ts:15-19` | `Storage` interface: `put` / `get` / `signedUrl` — the TTS cache |
| `backend/src/lib/db.ts` | `prisma`, `recordLlmCall` — the metering insert |
| `backend/src/lib/error-codes.ts` | the voice codes; S05 left `VOICE_UNAVAILABLE` + `VOICE_SESSION_EXPIRED` |
| `backend/src/lib/env.ts:39-47` | the `ELEVENLABS_*` / `VOICE_*` keys |
| `frontend/src/lib/use-voice-session.ts` | mic-only after S05 (no socket); S06 hangs the turn loop off it |
| `frontend/src/lib/use-mic-permission.ts:60` | the `AnalyserNode` RMS loop — the VAD signal |
| `frontend/src/lib/voice/device-check.ts` | written, tested, unimported (#107) |
| `frontend/src/lib/voice/active-speaker.ts` | written, tested, unimported (#107) |
| `frontend/src/lib/voice/downgrade.ts:7` | `voiceDowngrade`; called by `use-voice-session.ts` (S06) and pre-join (S07) |
| `frontend/src/components/room/voice-controls.tsx` | mute, mic meter, status chip; S09 adds the timer, S10 the error copy |
| `frontend/src/components/dashboard/modules.tsx:44` | `resumeHref` — the mode branch behind Continue. There is no `components/home/`|
| `frontend/src/app/interviews/new/page.tsx:35` | `useState<'text' \| 'voice'>('text')` — the default S08 flips |
| `packages/ai/config/model-prices.yaml` | `elevenlabs/tts` + `elevenlabs/stt`; S05 deleted `elevenlabs/conversational` |

## Schema (tables this ledger reads/writes)

| Table | Reads | Writes |
|---|---|---|
| `interviews` | `state`, `mode`, `language`, `current_index`, `started_at`, `spent_usd`, `budget_usd` | `mode='text'`, `ended_reason='time_exhausted'`, `spent_usd` |
| `personas` | `voice_id` (the ElevenLabs voice; seeded at `prisma/seed.ts:197,206` with placeholders that must be replaced) | — |
| `questions` | `text`, `id` (the audio cache key) | — |
| `answers` | — | `INSERT` `input_mode='voice'` (via I06 only) |
| `llm_calls` | — | `INSERT` `provider='elevenlabs'`, `model='tts'\|'stt'`, `unit_kind='character'\|'second'` |
| `voice_sessions` | — | **dropped** by S05 (ADR-S05) |

## Conventions

**Error codes** live in `backend/src/lib/error-codes.ts` and are the only thing the API returns
— never a display string. `frontend/messages/{en,tr}.json` under `errors.*` carries the copy,
and both locales change together or neither does.

**Log shape:** `logger.info({ traceId, interviewId }, 'CODE')`. Never the API key, never the
audio bytes, never transcript text (K6, §7.2).

**Secrets:** `ELEVENLABS_API_KEY` is read in `elevenlabs-speech.ts` and nowhere else. It must
not appear in a response body, a header, a log line, or a test fixture.

**External calls** go through the seam, never `fetch` inline in a route — that is what makes
the acceptance ring runnable with no network.

**Migration rule (ADR-F02):** no new table, no column type change, no new enum value. This
ledger's one schema change was the `voice_sessions` drop
(`20260807170000_drop_voice_sessions`). There are no more.

**Prose:** EXECUTE.md §7b. Comments only where the code cannot say it. Docs terse.
