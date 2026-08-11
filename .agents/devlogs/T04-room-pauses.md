---
task: T04
author: Ahmet
sessions: [2026-08-11]
model: claude-opus-5
model_recommended: claude-opus-5
iterations: 3
tools: [superpowers:executing-plans]
---

## Session 1 — 2026-08-11

### What I asked for / what came back
- Task file carried the client state machine as ten steps; T03's Notes carried the wire. Nothing
  about the design was decided here. What was decided here was how to satisfy the React Compiler
  lint without giving up either behaviour — two deviations, both in the task's Notes.

### Methodology trace
Steps 1/1b first, red before any source edit. AC-12/13 → new `conversation.test.tsx` (4 cases) +
one room case in `voice.test.tsx` → red → `pendingTurn` prop, `.resumed`, the frozen read →
green. The turn loop → six cases in `use-voice-session.test.tsx` on fake timers → 5 red (the
sixth, the in-flight guard, passed vacuously — no clock existed yet) → `stop(reason)`, the
restart-before-upload, the 13 s interval → green, 29/29.

Both load-bearing parts were mutation-checked rather than assumed: dropping `uploadingRef` from
the clock's guard reds the in-flight case (so it is no longer vacuous), and replacing the frozen
read with a live one reds the room case.

### Friction
- **Fake timers ate the meter.** `vi.useFakeTimers()` fakes `requestAnimationFrame` by default
  and overwrote `audio-mock`'s stub, so `audio.level()` fed nothing to the VAD and no recording
  ever stopped. Fixed with an explicit `toFake` of timers and `Date` only. Cost one debugging
  round; written into the task Notes so it costs nobody a second.
- **`react-hooks/immutability` refuses the ref-callback pattern once the callback is memoised.**
  `onstop` re-opens the recorder, so `startRecording` closes over `startRecordingRef`, so
  `useCallback(startRecording)` makes the ref a value "previously passed as an argument to a
  hook" and the effect that assigns it becomes an error. Tried a null-seeded ref and a second
  ref first; both still failed, because the capture path is `useCallback` itself. Dropped the
  memo — the room read the ref, never the identity.
- **`set-state-in-effect` on the notice.** The read-once branch passed (ref-latched), the clear
  branch did not. Latched that one too rather than moving the freeze into the component.
- Root `npm run lint` is clean on all three of those. `npm run -w frontend lint` is the run that
  found them, which is the point of the ledger's "the root lint does not cover this config".

### What I rejected and rewrote by hand
- **A `phase: 'probing'`.** First instinct, and wrong: the avatar would stop saying *listening*
  and the bars would stop moving during a pause the candidate is still in the middle of. The
  task said no new phase; it was right, and the reason is visible only in the room.
- **Restarting the recorder in `.then()`.** Reads better, loses every word said during the round
  trip — the exact failure this ledger exists to fix, moved one second later where no test would
  miss it. Restart is before `mutateAsync`, and there is now a test that asserts the ordering by
  counting open recorders from inside the stubbed route.
- **Seeding `holding` from `GET /state`.** Would light the pause line on the reload path too, at
  the cost of two sources for one fact. Left as hook state and wrote the gap into the ledger's
  tech debt instead.
- **A fake-timer rewrite of `voice.test.tsx`** (task step 1b's stronger reading). That file
  drives real `userEvent`; explicit `waitFor` ceilings close #219 on their own, and the fake
  clock belongs in the hook's tests where the 13 s window actually is.
