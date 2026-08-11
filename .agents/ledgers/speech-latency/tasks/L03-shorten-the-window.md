# L03 — Shorten `VAD_SILENCE_MS`, now that a gate makes it safe
REPO: (this repo) · Depends: T04, L01 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — one constant and one test assertion. The judgement (is the gate
accurate enough?) is a precondition stated in ADR-L04 and checked with data, not something this
session decides. If it is wrong, a candidate is interrupted mid-sentence on the first try, which
is as loud as a failure gets.

## Goal
`VAD_SILENCE_MS` is 2 000 ms — the **single largest line in the whole latency budget**, larger
than any provider call, and entirely ours. ADR-T01 argued a completeness gate makes a short window
safe and then left the constant alone. This is where that argument gets followed through.

Measurement makes the case stronger than ADR-T01 realised: STT costs ~500 ms fixed plus ~35 ms per
audio-second, and T04's restart-before-upload means every fragment except the last is transcribed
**while the candidate is still talking**. So only the final fragment's STT is on the critical path,
and a shorter window makes that fragment short. 2 000 → 1 000 buys ~1 000 ms of window plus
~250 ms of STT.

## Non-negotiables
- **Do not ship this on faith.** The precondition is gate accuracy on real, noisy speech, and it
  is currently unmeasured. The failure mode of a short window plus an inaccurate gate is the exact
  complaint this whole line of work started from — being cut off mid-thought — arriving faster
  than before. If the data is not there, set the row `blocked` and say what is missing.
- **T04 must be shipped first, not merely written.** Without restart-before-upload, extra probes
  land *on* the critical path instead of off it, and a shorter window makes the room **slower**.
  This is a correctness dependency, not a merge-order preference.
- **One change at a time.** L01 lands separately so each keeps its own attributable before/after.
  Do not bundle.
- **The test assertion is a tripwire, not an obstacle.** `use-voice-session.test.tsx:359` asserts
  the exact value on purpose. Change it deliberately, in the same commit, with the new number.
- **Do not touch the VAD effects while you are in there.** `use-voice-session.ts:371-385` polls
  the window from a timestamp rather than holding a `setTimeout` keyed to `mic.level`, because
  that effect is torn down ~60×/s and can never elapse. The comment above it is load-bearing.

## Context (anchors)
- `frontend/src/lib/use-voice-session.ts:32` — the constant.
- `frontend/src/lib/use-voice-session.ts:371-385` — the two VAD effects; read the comment first.
- `frontend/src/lib/use-voice-session.test.tsx:359` — the assertion that must move with it.
- REFERENCE.md — the STT-scaling table this task's arithmetic comes from.
- `.agents/ledgers/turn-taking/DECISIONS.md` ADR-T01 — the argument this task completes.
- Gate telemetry from turn-taking T01/T03 — `CONDUCTOR_TURN_HELD` and the gate's verdicts, which
  are the data this task needs.

## Steps
- [ ] **1. Check the precondition.** T04 shipped, and gate verdicts available from real use. If
  either is missing: `blocked`, with what is needed. Do not proceed.
- [ ] **2. Establish the error rate.** From logged verdicts: how often did the gate say `finished`
  on a fragment that turned out to be mid-thought (the interruption), and how often did it hold a
  fragment that was clearly done (dead air, bounded by the 13 s clock)? The first number is the
  one that gates this task.
- [ ] **3. Pick the window from the data, not from this file.** 1 000 ms is the proposal, not the
  answer. A gate with a higher false-`finished` rate wants a longer window; a very accurate one
  could go shorter still.
- [ ] **4. Change the constant and its assertion.** One commit, both files.
- [ ] **5. Measure end to end** the same way REFERENCE.md's baseline was taken. Record
  before/after in `## Notes`.
- [ ] **6. Listen to it.** Numbers cannot tell you whether the room now feels rushed. Answer three
  questions at a normal speaking pace, including one where you pause to think mid-sentence, and
  write down what it felt like. If it interrupts you once, that is a fail regardless of the
  measurement.

## Definition of done
- The gate's false-`finished` rate is written down, and the chosen window is justified against it.
- Measured before/after recorded.
- A human has spoken to it and confirmed it does not interrupt.
- `use-voice-session.test.tsx` asserts the new value.

## Verification
```bash
npm run -w frontend test -- use-voice-session
npm run -w frontend lint
```
Then, and this is the real verification: a live voice interview where you deliberately pause
mid-sentence. The unit test proves the constant changed; only the room proves it was safe to.

## Notes
_(fill in when done — the error rate, the chosen window and why, the measured before/after, and
what it felt like to speak to)_
