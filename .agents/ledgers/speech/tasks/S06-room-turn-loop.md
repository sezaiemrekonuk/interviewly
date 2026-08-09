# S06 — Room turn loop: speak, VAD-record, upload, advance
REPO: (this repo) · Depends: S02, S03, W10 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — the state machine nobody wrote down: playback, recording, silence
detection, upload and refetch, each with a failure that must land in text rather than a stuck
room. Also the task most likely to invent a client-side index, which K11 forbids.

## Goal
Owner's ask:

> "Zoom'daki gibi olsun — soru sesli sorulsun, ben konuşayım, o devam etsin."
> — IDEA.md §3.2, §4.3 screens 12–13, speech spec *The turn loop*

Replaces the WebSocket hook with the loop that makes voice mode actually run: play the question,
record the answer, stop on silence, upload, refetch state, repeat. Wires the three finished
`frontend/src/lib/voice/` modules that have never been imported (#107).

## Security boundaries
- **No credential in the browser.** The room calls our origin only. If this task finds itself
  needing an ElevenLabs URL or key, it has misread ADR-S02.
- **Audio is not retained client-side either.** The `MediaRecorder` chunks are uploaded and
  released; no blob URL survives the turn, no download affordance is added.

## Non-negotiables
- **The server owns the index.** `GET /interviews/:id/state` is the only source of
  `currentIndex` and `currentQuestion` (K11). The loop refetches after each answer; it never
  increments locally, and it never renders a question the server has not delivered.
- **VAD is a convenience, not enforcement.** A manual Stop is always visible. The server's
  ceiling is what ends the interview (ADR-S06).
- **Every failure lands somewhere real.** Playback failure, mic loss mid-turn, upload failure,
  a 503 from either route — each either retries or downgrades to text. No branch leaves the room
  spinning, which is the #83/#89 failure pattern this project already has three times.
- **One audio graph.** `use-mic-permission.ts:60` already owns an `AnalyserNode`;
  `voice/device-check.ts:45` owns a second. Pick one as the VAD source and say which in
  `## Notes`. Do not add a third.
- **Mute means mute.** The existing `toggleMute` must stop the recorder from capturing, not just
  zero the meter.

## Context (anchors)
- `frontend/src/lib/use-voice-session.ts` — **rewrite.** Everything below `mintVoiceSession` and
  the `BEAT_BY_FRAME` table goes; the beat vocabulary (`listening` / `speaking` /
  `acknowledging`) and the `status` shape stay, because `room/page.tsx:96-99` and
  `voice-controls.tsx` already consume them.
- `frontend/src/lib/voice/device-check.ts:15-83` — `checkDevices()`, RMS subscription,
  `previewStream`, `release()`. Written, tested, unimported (#107).
- `frontend/src/lib/voice/active-speaker.ts:9-30` — `resolveActiveSpeaker()`; the round decides
  who speaks, audio decides how loud (K2).
- `frontend/src/lib/use-mic-permission.ts:60` — the existing RMS loop.
- `frontend/src/lib/query.ts:329` — the existing answer mutation; the audio upload is its
  sibling, not its replacement.
- `frontend/src/app/interviews/[id]/room/page.tsx:49-54,96-99,177-184` — where the hook is
  consumed.
- `frontend/src/components/room/voice-controls.tsx` — mute, meter, status chip; S09 adds the
  timer and S10 the error copy, so leave room for both.

## Steps
- [x] **1. Turn-loop test red** — a Playwright or vitest-with-mocks scenario: audio plays, a
  recording stops on silence, the upload fires once, the state refetch advances the question.
  See it red.
- [x] **2. Playback** — fetch `GET …/questions/:index/speech`, play, beat `speaking`. A playback
  error is a downgrade, not a retry loop.
- [x] **3. Record** — `MediaRecorder` on the existing mic stream, beat `listening`.
- [x] **4. VAD** — stop after ~2 s below the RMS threshold (spec Open question 2: 2 s, tunable,
  a guess until heard). A visible Stop button does the same thing immediately.
- [x] **5. Upload** — `POST …/answers/audio`, beat `acknowledging`, then refetch state.
- [x] **6. Wire the orphans** — `active-speaker.ts` drives the persona tile ring;
  `device-check.ts` or `use-mic-permission.ts` (one of them) is the mic and VAD source.
- [x] **7. Failure branches** — enumerate them and give each a state: playback failed, mic lost,
  upload failed, 503 from either route, ceiling reached. S10 supplies the copy; this task
  supplies the branch.
- [x] **8. Unmount hygiene** — recorder stopped, tracks stopped, `AudioContext` closed. A camera
  or mic light left on after leaving the room is the bug users never forgive.

## Definition of done
- A voice interview runs end to end against the real routes: question spoken, answer recorded
  and transcribed, index advanced, next question spoken.
- speech AC-9 holds: no `WebSocket` is constructed anywhere in `frontend/src`.
- No branch leaves the room without a next action.
- Leaving the room leaves no live media track.

## Verification
```bash
npm run -w frontend test -- use-voice-session room/voice
grep -rn "new WebSocket" frontend/src
```
Expected: tests green; the grep prints nothing.

## Notes

**The loop lives in `use-voice-session.ts`.** Signature is now
`useVoiceSession(id, { enabled, turn, vad })`. `turn = { index, questionId }` comes from
`GET /state` via `room/page.tsx` and is `null` outside `hr_round`/`tech_round` — that null is
the only thing that stops a turn starting. Returns the old shape plus `recording`, `stop()`,
`error`, `retry()`.

Phases → beats: `speaking` (playing the question), `listening` (recording), `uploading`
(`acknowledging`), `idle`/`failed` → `null`. `spokenRef` is keyed by `questionId`, so a
re-render never re-speaks and only the server delivering a new question starts the next turn.

**VAD source: `use-mic-permission.ts`.** Its `AnalyserNode` is the only audio graph the room
builds; `voice/device-check.ts` stays unimported (#107 still open for it). The hook reads
`mic.level` and arms `setTimeout(stop, silenceMs)` only after the level has crossed
`VAD_THRESHOLD` once — an unspoken turn keeps listening instead of uploading two seconds of
nothing. `VAD_SILENCE_MS = 2000`, `VAD_THRESHOLD = 0.05`, both overridable per call
(`vad: { silenceMs, threshold }`) — spec Open question 2 stays tunable without a config key.
`use-mic-permission` also returns `stream` now, which is what `MediaRecorder` records.

**Failure branches** (copy is S10's; each has a next action):

| Branch | What happens |
|---|---|
| playback `error`, or `play()` rejects | `voiceDowngrade()` then refetch — one attempt, no loop |
| `VOICE_UNAVAILABLE` / `VOICE_SESSION_EXPIRED` | refetch (server already ended/downgraded) + code shown |
| `QUESTION_NOT_CURRENT` / `INVALID_STATE_TRANSITION` / `BUDGET_EXCEEDED` | silent refetch, no copy |
| `SPEECH_AUDIO_INVALID` / `SPEECH_TRANSCRIPTION_FAILED` / transport | `error` + Retry, which re-records without re-buying the question audio |
| mic lost mid-turn | recorder stopped; `status: 'lost'` banner + reconnect is the action |

Mute pauses the recorder and unmute resumes it, so muted time is not in the uploaded audio.
Unmount stops the recorder **without** uploading, pauses playback, revokes the object URL; mic
tracks and `AudioContext` were already `use-mic-permission`'s job.

**Sibling mutation, not a replacement:** `useSubmitAudioAnswer` (`query.ts`) posts the
multipart part beside `useSubmitAnswer` and invalidates the same key. It sends the media type
**bare** — `MediaRecorder` reports `audio/webm;codecs=opus` and `stt.ts`'s allow-list holds
media types, so the `;codecs=` suffix would have been `UNSUPPORTED_MEDIA_TYPE`. `api.ts` gained
`apiGetBlob` (binary GET, JSON error body) and `apiPostForm`.

`room/page.tsx` picks the live tile with `resolveActiveSpeaker(room.state)` (#107's second
orphan), falling back to `room.persona`. New copy key: `room.voice.stop`, both locales.

**Test harness:** `src/test/audio-mock.ts` stands in for `AudioContext`, `MediaRecorder`,
`Audio` and `URL.createObjectURL`, and hands the test the frame pump so an RMS travels through
the real meter. For the next one: undici's `Response` rejects a jsdom `Blob` body — build audio
responses from a `Uint8Array`.

Verification (rebased onto `716245b`): `npm run -w frontend test -- use-voice-session room/voice`
→ 21 passed; the `new WebSocket` grep prints nothing. Gates: lint, typecheck, `npm test`
654 passed, acceptance 102/102. Three local repairs were needed first, none of them this diff's:
`npx prisma generate` (master's `uploads_unique_per_owner` left the generated client stale —
typecheck is red on a clean tree without it), `prisma migrate deploy` against the dev DB (upload
scenarios and `report_questions_score_idx`), and four keys master added to `.env.example`
(`TRUST_PROXY`, `S3_REGION`, `NEXT_PUBLIC_ASSETS_PREFIX`, `NEXT_PUBLIC_MASCOT_SHA256`) copied
into the untracked local `.env`, which is what `env-drift.test.ts` compares.

**For S07:** mic-denied lands on `status: 'lost'` here with no downgrade call — that call is
S07's. **For S09:** `VoiceControls` is where the timer goes; the bar now also carries Stop while
recording. **For S10:** `session.error` is the code, rendered through `useErrorMessage` — S10
replaces that one generic notice with per-code copy.
