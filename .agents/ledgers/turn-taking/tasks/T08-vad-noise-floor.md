# T08 — The VAD never heard the candidate: arm against the room, not a number
REPO: (this repo) · Depends: T06 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — the same shape as T06 and the reason both were expensive: every layer
reported healthy and the product did nothing. A threshold that is too high has no error state.

## Goal
Owner, on the fourth live run:

> "again happened same stuff asked question again and there was no my saved batchi"

**Measured:** four runs, zero `SPEECH_STT_TRANSCRIBED` between them. `CONDUCTOR_SILENCE_TURN`
fired 13 s after each recorder opened, which means `heardRef` was false the whole time. The owner
confirmed the Stop button was visible (so `phase === 'listening'`) and that their own mic bars
moved (so `mic.level > 0`). One link left: `mic.level` never reached `VAD_THRESHOLD = 0.05`.

**Cause:** 0.05 RMS is a loud voice on a close mic. Nothing quieter is ever heard, so no probe is
ever sent, nothing is ever held, and the recovery notice has nothing to show — which is what the
owner reported three times running as "it didn't save".

## Non-negotiables
- **Never less sensitive than before.** The fixed threshold becomes a ceiling on the arming bar,
  so no room that worked before can stop working.
- **The floor is per recording**, reset in `startRecording`, and only moves down within a turn.
- **A level of exactly 0 teaches it nothing.** That is a microphone delivering nothing (muted,
  suspended — see T06), and learning from it drops the bar to `VAD_FLOOR` for the whole turn.
- **`VAD_SILENCE_MS` stays 2 000** — `speech-latency` `L03` owns it.
- **`VAD_THRESHOLD` keeps its value and its export.** `use-voice-session.test.tsx` reads it.

## Context (anchors)
- `frontend/src/lib/use-voice-session.ts` — `VAD_THRESHOLD`, the new `SPEECH_OVER_FLOOR` /
  `VAD_FLOOR`, `floorRef`, the arm effect, and `startRecording`'s reset.
- `frontend/src/lib/use-mic-permission.ts:59-77` — where `level` is produced (RMS over the
  analyser's float buffer, once per animation frame).

## Steps
- [x] **1. Test red** — speech at a fifth of `VAD_THRESHOLD` produces a probe once the floor is
  known; steady room tone never arms however loud.
- [x] **2. `armAt = min(threshold, max(floor × 3, VAD_FLOOR))`**, floor learned from every frame
  below it, exact zeros ignored.
- [x] **3. Reset the floor per recording** so a probe restart re-measures.

## Definition of done
- A quiet speaker is probed. A steady noise floor is not.
- Every existing VAD test still green, including the jitter one.
- `npm run -w frontend lint` passes.

## Verification
```bash
npm run -w frontend test -- use-voice-session
npm run lint && npm run typecheck && npm test
```
Then, in the real room — the check none of the four runs got to:
- speak normally, pause 2 s → `SPEECH_STT_TRANSCRIBED` in the API log within a second, and the
  interviewer answers without a 13 s wait.
- refresh mid-answer after a pause → the recovery notice, in the stage foot row above the
  control bar.

## Notes

**Shipped:** `floorRef`, `SPEECH_OVER_FLOOR = 3`, `VAD_FLOOR = 0.01`, and the arm effect's
`armAt`. Mutation-checked: pinning `armAt` back to the fixed `threshold` reds the quiet-speaker
test and nothing else.

**The exact-zero rule was found by the test, not by design.** jsdom's initial level is exactly 0,
which drove the floor to 0 and made `VAD_FLOOR` the bar — at which point steady 0.02 room tone
counted as speech. A real microphone never reports exactly 0, but a muted or suspended one does
(T06), so the rule earns its place beyond the test.

**This is the fourth cause of one complaint.** T04's notice was invisible, T05's gate over-held,
T06's meter was asleep, and T08 is why nothing was ever uploaded in the first place. The first
three were all real and none of them was what the owner kept hitting. Worth remembering the shape
of it: every fix was verified against jsdom, and jsdom has no microphone.

## Live verification, 2026-08-12 05:21–05:23

**The room heard a candidate for the first time.** Six `SPEECH_STT_TRANSCRIBED` lines in one
interview (8.1 s, 6.3 s, 4.5 s, 7.5 s, 25.1 s, 3.3 s of audio); before this change the same
microphone produced zero across four runs. Fragments joined 111 → 192 → 207 chars, the 4 s flush
conducted them, the gate forwarded a 336-char answer as finished, and `CONDUCTOR_ADVANCED` moved
to question 2. The whole ledger — gate, buffer, join, both clocks, the ceilings — ran end to end
for the first time.

Not exercised by that run: the recovery notice (no refresh), and the 13 s silent-turn path.

## Verification output

`npm run -w frontend test -- use-voice-session` → 33 passed. Root `npm test` → 1121 passed,
up from 1119. `npm run lint`, `npm run -w frontend lint`, `npm run typecheck` clean. No backend
file changed, so the acceptance ring was not re-run.
