---
task: T05
author: Ahmet
sessions: [2026-08-11]
model: claude-opus-5
model_recommended: claude-opus-5
iterations: 1
tools: [update-initiative]
---

## Session 1 — 2026-08-11

### What I asked for / what came back
- Not a planned task. The owner ran T04 in the real room and reported two problems; this ledger
  row was written from that report and executed in the same session, which EXECUTE.md § 6.9
  normally forbids. The owner asked for the fix in-session, so the checkpoint was theirs to
  waive; the bookkeeping was done in full rather than skipped.
- The owner chose "short flush + better prompt" over either alone, from four options costed
  against each other (clock only, prompt only, both, or replacing the gate with the offline
  heuristic).

### Methodology trace
Diagnosis before design: `docker logs interviewly-api-1` → four `SPEECH_STT_TRANSCRIBED`, three
`CONDUCTOR_TURN_HELD` at 134/111/142 chars → the gate over-holds, and the 13 s clock is the only
exit. The complaint named a symptom ("it still waited"); the log named the cause.

ADR-T06 → two clock tests in the T04 fake-timer block → red → `FLUSH_HELD_MS` and the branch →
green (31). Prompt v2 → K9-contract tests → green (10). `CONDUCTOR_TURN_FORWARDED` → `stt.ts` →
28 unchanged.

### Friction
- The interesting failure was in T04, not here: the recovery notice rendered inside the voice
  transcript panel, which voice mode keeps closed and CSS clips to a pixel. AC-13 was satisfied,
  the test passed, and the candidate saw nothing. Found by the owner in ten minutes of real use.
  Fixed as `ResumedNotice` in the stage foot row; the test now asserts it is outside the panel,
  not merely outside the `<ol>`.
- Acceptance could not run: the stack was up under plain `docker compose up`, which publishes no
  host ports. Reported as skipped rather than assumed green, and the exact command left in Notes.

### What I rejected and rewrote by hand
- **Shortening `FORCE_SUBMIT_MS` globally**, which is what the owner's first suggestion literally
  says. It would cut the thinking window for a candidate staring at a hard question — the people
  the whole ledger exists to protect. Split the window instead and said why in ADR-T06.
- **Replacing the gate with `UNFINISHED_TAIL`**, the offline heuristic the stub already uses.
  Tempting: 780 ms and a provider call gone. Offered it to the owner as a costed option rather
  than taking it, because it cannot read a pause that lands on an ordinary word, and reversing
  ADR-T03 on a sample of four utterances is not a decision this session had the evidence for.
- **Asserting the prompt's judgement in tests.** The seam stubs the transport, so a test that
  "proves" a Turkish sentence is judged finished would be asserting my own fixture. Wrote the K9
  contract instead and marked the prompt half explicitly unverified in Notes and STATE.md.
