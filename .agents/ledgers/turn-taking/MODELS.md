# Turn-taking — Recommended Model Per Task

Opus for anything that can be wrong in a way a green test still passes — here that is the two
tasks holding the invariant that *the turn always ends*. Sonnet for the pieces whose failure
shows up the moment you run them.

EXECUTE.md §5 is the rule — the tier must match the model actually running, or the session prints
`TIER <ID> needs <tier>, running <model>` and ends.

| ID | Title | Model | Why |
|----|-------|-------|-----|
| T01 | The completeness gate | `claude-sonnet-5` | A prompt, a one-field schema, and a fifth method on a seam that already has four identical ones to copy. The two judgement calls — opting out of the fallback chain, and failing open — are stated outright in ADR-T03 and in the task's non-negotiables, so there is nothing left to decide. A wrong gate verdict is visible the first time you speak to it |
| T02 | The held partial | `claude-opus-5` | The atomic take is the whole task. A `GET` followed by a separate `DEL` passes every single-threaded test and double-submits a candidate's answer under concurrency; a missing `questionId` check passes every test that does not span a question boundary and joins a stale thought onto a new question. Both are silent, both corrupt the transcript the report is scored from |
| T03 | Turn paths, the silence turn, `pendingTurn` on `/state` | `claude-opus-5` | The invariant lives here. Silence rows must be counted by **both** ceilings or a silent candidate loops with the interviewer nudging forever — and every test passes while it does. The `resolveMessages` filter is a documented trap: widening it wrong deletes the entire candidate side of the room, and only a test that asserts candidate rows are still present catches it. Plus the trust boundary: this task is where a text field could quietly reappear on the voice route |
| T04 | The room | `claude-opus-5` | The client state machine nobody wrote down, and the task most likely to reintroduce the two failures S06 documented at length: a `setTimeout` keyed to `mic.level` that can never elapse, and an effect keyed on `messages` instead of assistant ids that leaves the room permanently mute. Adds a third: restarting the recorder before the upload, which is what stops speech during the probe from being lost, and which no test will miss if you forget it |
| T05 | Gate accuracy: two clocks and prompt v2 | `claude-opus-5` | It moves the number that makes *the turn always ends* true. Two thresholds is two chances to leave a candidate waiting on an interviewer that will never speak, and a wrong one is invisible until someone sits in the room. The prompt half is sonnet work; the clock half is not, and they ship together |
| T06 | The suspended `AudioContext` | `claude-opus-5` | Wrong in a way a green test still passes, which is MODELS.md's own definition of opus work: permission granted, recorder running, Stop button showing, and every measurement zero. It survived five ledgers of tests because jsdom has no audio and every one of them stubs the analyser |
| T07 | Unprobed speech and the page unload | `claude-opus-5` | A second, unattended upload path on the trust boundary ADR-T02 guards, running at the one moment nothing can be verified afterwards. A beacon that sent the wrong thing would be invisible |
| T08 | The VAD's noise floor | `claude-opus-5` | A threshold that is too high has no error state: the meter reads, the recorder records, the room waits, and nothing anywhere is wrong. It cost four live interviews and survived every test in the repo |

## Summary

- **`claude-opus-5` (7 tasks):** T02, T03, T04, T05, T06, T07, T08
- **`claude-sonnet-5` (1 task):** T01

Rule of thumb for this ledger: **if getting it wrong leaves the candidate waiting on an
interviewer that will never speak, it is opus.** T01 cannot do that — it fails open by
construction. The other seven can.
