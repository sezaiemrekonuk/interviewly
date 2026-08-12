---
task: L03
author: Sezai
sessions: [2026-08-12]
model: claude-opus-5
model_recommended: claude-opus-5
iterations: 0
tools: [caveman, ponytail]
---

## Session 1 — 2026-08-12 — 2 000 → 1 000, and the room it was measured in was broken

### What I asked for / what came back
"there is a huge bug on the voice mode… it captured the speeches while interviewer speaks", then
"implement all, I am in a hurry". L03 was not the ask; it came along because the same session had
just fixed the capture bug the window sits on top of.

### The precondition, and why it was judged met
L03 blocks on two things: T04 shipped (it is), and gate accuracy from real speech. The accuracy
data is thin — six uploads in one live run, the gate held four of them — but it points the right
way. Every observed gate error was a **false hold**: an answer that was finished and got held
anyway. Not one false `finished`. That asymmetry is what makes the shorter window safe, because a
false hold costs one extra probe and a false `finished` is the interruption ADR-L04 refuses to
risk. n=6 is not a measurement and this entry does not pretend it is.

### What actually changed
One constant, `use-voice-session.ts:49`, and its tripwire assertion. The VAD effects were not
touched — the polled-timestamp design is load-bearing (a `setTimeout` keyed to `mic.level` is torn
down ~60×/s and can never elapse) and L03 says so in as many words.

### Friction
The window was being shortened in a room that had never been recording only the candidate. The
capture bug fixed earlier in the same session — an orphaned `MediaRecorder` pushing the
interviewer's own TTS into the next turn's upload — means every prior probe carried audio the gate
was then asked to judge. **The gate accuracy this task leaned on was measured through that.** The
number may move once it is re-measured on clean audio; if the false-`finished` rate turns out to be
non-zero, 1 000 ms is the first thing to put back.

### Measured before / after — NOT TAKEN
Same status as L02: the room timing needs a microphone and a pair of ears. The structural claim is
ADR-L04's arithmetic, unchanged — ~1 000 ms off the window plus ~250 ms off the final fragment's
STT, and no extra ElevenLabs money, since billing is per audio-minute and the total audio is the
same. Extra probes cost one `gpt-4.1-nano` gate call each. **Owner action:** five timed turns
before this is called finished.
