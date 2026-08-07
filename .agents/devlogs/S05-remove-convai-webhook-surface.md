---
task: S05
author: Ahmet
sessions: [2026-08-07]
model: claude-opus-5
model_recommended: claude-opus-5
iterations: 0
tools: [repo-memory]
---

## Session 1 — 2026-08-07

Opus tier, as MODELS.md requires: the risk in a deletion task is what quietly goes with it, and
what this one deletes was believed to contain the spend cap.

### What I asked for / what came back
- Asked: S05 — delete the convai/webhook/reconciliation surface, drop `voice_sessions`, prove
  the ceiling still fires.
- Returned: 9 backend files, 2 worker files, 3 feature files + 3 step-definition files deleted;
  `voice_sessions` dropped in `20260807170000_drop_voice_sessions`; `speech_fallback.feature`
  replacing `voice_fallback.feature`; a mic-only `use-voice-session.ts`.

### Methodology trace
- @AC-7 → `.agents/features/speech_fallback.feature` (2 scenarios) → **green on first run, by
  design**: the step file rewrites the trigger (`FakeSpeechProvider.failNext` on the TTS route)
  for behaviour that already existed (`tts.ts` catches `VOICE_UNAVAILABLE` → `downgradeToText`).
  Step 1 asks for green-before-deletion precisely so the invariant is demonstrably covered when
  the old file goes; a red here would have meant the downgrade was already broken.
- @AC-6 → `speech_turn.feature` (TTS + STT past-ceiling) → green before `webhook-auth.ts` was
  touched, green after it was deleted. Same two scenarios, unmodified.
- `iterations: 0` is honest: no red→green cycle. The work was deletion, and `npm run typecheck`
  was the loop — it named every remaining reference, one file at a time.

### Friction
- The task's premise — "`isPastCeiling` is the only writer of `time_exhausted`" — was **already
  false** when I started. S02 wrote `isPastSpeechCeiling` into `tts.ts` and S03 imported it, so
  the deletion removed a dead second copy. I ran @AC-6 before touching anything to establish
  that rather than assume it.
- `npm run typecheck` failed on `fontkit` before I changed a line. `npm install` fixed it — a
  stale local `node_modules`, not the repo. Checked against a stashed tree before believing it.
- `git rm` with a modified file in the list aborts **partway through**: three paths were already
  removed when it errored on the fourth. Re-ran with `-f` on the remainder.
- The compose DB publishes nothing in `compose.yaml` and host `:5432` is a different Postgres,
  so the acceptance ring needed an ad-hoc port override file. Memory had this; the port numbers
  in it were stale.

### What I rejected and rewrote by hand
- **Rejected: deleting `use-voice-session.ts`.** The file list did not name it, but it held the
  `new WebSocket` AC-9 forbids, and three room components import its types. Deleting it drags
  the room shell in, which is S06's task. Rewrote it as a mic-only hook keeping the exported
  surface, with `beat` pinned to `null` and a `ponytail:` pointing at S06.
- **Rejected: deleting `src/test/websocket-mock.ts` as instructed.** `installMediaDevicesMock`
  lives in it and `voice.test.tsx`'s mic-release test needs it. Renamed to
  `media-devices-mock.ts` and removed only the WebSocket half.
- **Rejected: keeping `connect-src 'self' wss://api.elevenlabs.io`.** The DoD says AC-9 is
  "`middleware.ts:9` still reads `connect-src 'self'`" and it did not — the socket allowance
  outlived the socket. Narrowed it.
- **Rejected: leaving `voice.test.tsx`'s reconnect test in a rewritten form.** Its subject was a
  dropped socket. Deleted it and wrote the gap into the task Notes and STATE (S07 re-covers it)
  rather than inventing a mic-denial trigger S07 owns.
- **Rejected: editing `specs/2026-07-29-voice.md` and `IDEA.md`.** They describe an architecture
  that was built and then reversed; ADR-S01 supersedes by reference, never by edit.
  `EXECUTE.md`'s tunnel paragraph I did fix — that one is an instruction to humans, not a record.
