---
task: T08
author: Ahmet
sessions: [2026-08-12]
model: claude-opus-5
model_recommended: claude-opus-5
iterations: 3
tools: [update-initiative]
---

## Session 1 — 2026-08-12

### What I asked for / what came back
- Fourth report of one complaint. The first three fixes (T04's invisible notice, T05's
  over-holding gate, T06's suspended `AudioContext`) were all real defects and none of them was
  what the owner kept hitting.
- Two owner answers closed it in one exchange: Stop button visible (recorder open) and mic bars
  moving (meter alive, `level > 0`). That leaves exactly one link — `level` never reaching
  `VAD_THRESHOLD` — and no amount of code reading would have chosen between "alive but quiet" and
  "dead" on its own.

### Methodology trace
Log → owner → one link. Zero `SPEECH_STT_TRANSCRIBED` across four runs with
`CONDUCTOR_SILENCE_TURN` 13 s after each recorder opened ⇒ `heardRef` false throughout. ADR-T07 →
two tests (quiet speaker probes, steady room tone does not) → red → `armAt = min(threshold,
max(floor × 3, VAD_FLOOR))` → one still red → the exact-zero rule → green (33). Mutation-checked:
pinning `armAt` back to the fixed threshold reds the quiet-speaker test alone.

### Friction
- I had this theory in round three and **rejected it** in favour of the suspended-context bug,
  because a fixed threshold was "a magic number I shouldn't guess at". The number was the bug.
  What made the difference was not more reading — it was asking the owner to look at one thing.
- The second test failed for a reason the design had not considered: jsdom's initial level is
  exactly 0, the floor learned it, and `VAD_FLOOR` became the bar. The fix (never learn from an
  exact zero) is right in a real browser too — a muted or suspended mic reports 0 and a real one
  never does — so the test found a genuine hole rather than merely disagreeing with the code.

### What I rejected and rewrote by hand
- **Lowering `VAD_THRESHOLD` to 0.02.** One line, would have fixed this microphone, and would be
  wrong for the next one in the other direction. Three times the measured floor needs to know
  nothing about the hardware.
- **A watchdog that uploads whenever the room has listened too long.** Rejected in T06 and again
  here: it would have masked all four of these bugs and made the room's behaviour depend on a
  timer instead of on hearing. What was missing was sensitivity, not another deadline.
- **Trusting my own reasoning over the owner's eyes for a second round.** The costly part of this
  ledger was three fixes shipped against theories that a single question would have falsified.
