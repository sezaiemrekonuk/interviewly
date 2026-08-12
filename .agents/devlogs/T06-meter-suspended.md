---
task: T06
author: Ahmet
sessions: [2026-08-12]
model: claude-opus-5
model_recommended: claude-opus-5
iterations: 2
tools: [update-initiative]
---

## Session 1 — 2026-08-12

### What I asked for / what came back
- The owner's report named two suspects — Redis and the gate — and both were innocent. Redis was
  healthy with zero errors; the interview was still `mode=voice`, so no downgrade had happened;
  and the run's API log carried **zero** `SPEECH_STT_TRANSCRIBED`. Nothing had been uploaded at
  all, which meant neither suspect had been reached.

### Methodology trace
Log first, code second. `docker logs interviewly-api-1` → no STT in the window → the failure is
client-side and upstream of every server-side theory. Two questions to the owner split the rest:
Stop button visible (so the recorder WAS open) and the question audible (so playback finished).
That leaves exactly one link: `mic.level` never crossed the threshold, so `heardRef` never armed.
`use-mic-permission.ts:61` → `new AudioContext()` with no `resume()`. Three tests → red → `wake()`
→ green. Mutation-checked: removing the `wake(ctx)` call reds all three.

### Friction
- Two rounds were spent fixing symptoms of a bug I could not see. The gate's over-holding (T05)
  was real and measured, but it was not what the owner hit the second time — and I would have
  kept tuning prompts if the log had not said "no upload ever".
- The stub bit back: `vi.fn(() => ctx)` is not constructible, `meter()` runs inside `request()`'s
  `try`, and the `TypeError` surfaced as `state === 'denied'` — a mic-permission failure that had
  nothing to do with permissions. Wrote the reason into the test file so the next person reads it
  before losing the same twenty minutes.

### What I rejected and rewrote by hand
- **Lowering `VAD_THRESHOLD`.** My first theory was a quiet microphone, and 0.05 RMS is high
  enough that it was plausible. It would have "worked" — a lower threshold arms on noise — and it
  would have shipped a magic number over a real bug, exactly what the ledger's own "do not tune
  the numbers" rule exists to stop. The owner's two answers killed it before it was written.
- **A watchdog that force-submits when the room has been listening too long.** It would have
  masked this and every future variant of it. Wrote the observability gap into STATE.md's tech
  debt instead — what was missing was a signal that the meter is dead, not another timer.
- **Folding the `pagehide` flush into this task.** It is a second upload path on the trust
  boundary ADR-T02 guards; it belongs in `T07` with its own tests, not in a hotfix.
