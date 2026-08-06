# S06 — Room turn loop: speak, VAD-record, upload, advance
REPO: (this repo) · Depends: S02, S03, W10 · Status: todo
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
- [ ] **1. Turn-loop test red** — a Playwright or vitest-with-mocks scenario: audio plays, a
  recording stops on silence, the upload fires once, the state refetch advances the question.
  See it red.
- [ ] **2. Playback** — fetch `GET …/questions/:index/speech`, play, beat `speaking`. A playback
  error is a downgrade, not a retry loop.
- [ ] **3. Record** — `MediaRecorder` on the existing mic stream, beat `listening`.
- [ ] **4. VAD** — stop after ~2 s below the RMS threshold (spec Open question 2: 2 s, tunable,
  a guess until heard). A visible Stop button does the same thing immediately.
- [ ] **5. Upload** — `POST …/answers/audio`, beat `acknowledging`, then refetch state.
- [ ] **6. Wire the orphans** — `active-speaker.ts` drives the persona tile ring;
  `device-check.ts` or `use-mic-permission.ts` (one of them) is the mic and VAD source.
- [ ] **7. Failure branches** — enumerate them and give each a state: playback failed, mic lost,
  upload failed, 503 from either route, ceiling reached. S10 supplies the copy; this task
  supplies the branch.
- [ ] **8. Unmount hygiene** — recorder stopped, tracks stopped, `AudioContext` closed. A camera
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
