---
task: T07
author: Ahmet
sessions: [2026-08-12]
model: claude-opus-5
model_recommended: claude-opus-5
iterations: 1
tools: [test-driven-development]
---

## Session 1 — 2026-08-12

### What I asked for / what came back
- The task file was already a spec: five steps, four non-negotiables, and the anchors. What it
  wanted was the code and the number in its Notes — "what fraction of a 10 s answer actually
  survives the 64 KB cap, because that number decides whether this is a fix or a consolation".
  The code is done. The number is not, and could not be from here; see Friction.

### Methodology trace
Read the two consumers first (`use-voice-session.ts`, `query.ts`'s `useSubmitAudioTurn`) and then
the wire's other end (`stt.ts` `parseTurnAudio`), because the whole task is a second request onto
a route that refuses every field but `force`. Checked the transport before writing anything: auth
is a session **cookie** (`auth/middleware.ts:29`) and `API_BASE` is same-origin, so a beacon
carries credentials and no header has to be set — which is the one thing `sendBeacon` cannot do.

Then TDD. Extended the audio harness with a timeslice and a `chunk(bytes, fill)` control (jsdom's
`MediaRecorder` stub only ever produced one blob, at `stop()`), wrote eight tests, watched five
fail for the right reason — no timeslice, no beacon — and three pass vacuously because they assert
that nothing is sent. Implementation, green at 41, then two mutations:

- removing `chunksRef.current = [head]` reds the double-upload test alone;
- dropping the head chunk from the beaconed `File` reds the two that assert what a decoder gets.

### Friction
- **Step 4 was wrong and would have shipped undecodable bytes.** "Send the tail" reads fine until
  you remember where a WebM keeps its header: chunk 0, along with the codec init data, and nothing
  but clusters after it. A beacon of trailing clusters alone is not a file — Scribe would have
  answered `SPEECH_AUDIO_INVALID` at the one moment nothing can be retried or even observed. The
  amendment is one chunk wide (head + tail, skipping the middle) and is written into the task's
  Notes rather than left in a commit message.
- **The number the Notes asked for cannot be measured in this repo.** It is `60 000 − sizeof(chunk
  0)` divided by a bitrate nothing here sets — `MediaRecorder`'s default. jsdom has no encoder, so
  the honest output is the arithmetic at three plausible bitrates (~2.7 s to the whole answer) and
  a live check that writes down the transcribed line's duration. T08's tech-debt line, a third
  time: every audio path in this repo is stubbed, and this one adds an unload nobody can fake.

### What I rejected and rewrote by hand
- **Pinning `audioBitsPerSecond` to make the cap deterministic.** It would have turned the open
  question into a constant, and it changes the bytes every normal turn uploads and the audio the
  report is scored from — which this task's own non-negotiable forbids. The uncertainty is cheaper
  than the side effect.
- **Discarding the recorder after a successful flush.** My first answer to "the page might come
  back" (a restored background tab, whose beaconed audio would otherwise be uploaded again and
  joined onto the same turn twice). It dedupes, and it strands a returning candidate in a room
  with no open microphone until the 13 s clock ends the turn for them. Keeping **chunk 0 and
  nothing else** dedupes just as completely, leaves the recording running, and keeps the later
  blob openable — the header is exactly the part that must not be dropped.
- **`beforeunload`.** Named in the task and still worth restating: it does not fire on mobile
  Safari, and `heartbeat.ts:5` had already written that down for a different feature.
- **Reporting anything to the room about the flush.** `sendBeacon`'s boolean is about queueing,
  not delivery, so any notice built on it would be a claim the client cannot support. The recovery
  notice reads `GET /state` and stays the only thing that speaks about what the server holds.

## Session 2 — 2026-08-12, after the owner ran it

### What I asked for / what came back
- "it still not working", on a real refresh mid-sentence. It was working. The API log had the
  beacon (2.359 s of audio at 11:42:48), the join (96 → 120 chars), and Redis still had the words
  — `Oh my God. You slipped?`, which is what they said as they hit reload. What was broken was the
  half the candidate can see.

### Methodology trace
Four boundaries, in order, before touching anything:

1. **Is my code even running?** The room is served by `interviewly-web-1`, a baked standalone
   build with no source mounts — so `docker exec ... grep -rl pagehide /app/.next` rather than
   trusting the clock. It was there. (An earlier read of the same question compared a local
   timestamp against a UTC one and got it backwards; the grep is the check that cannot lie.)
2. **Did the beacon arrive?** Log timeline by title, then the payload fields — `seconds` on the
   STT line, `chars`/`probes` on the hold.
3. **Did the server keep it?** `redis-cli GET interview:…:pending-turn`, then the question id it
   was filed against versus the interview's `current_index` in Postgres. Both matched.
4. **So the client never showed it.** `page.tsx` latches on the first `/state` and freezes; that
   read is ~2 s before the gate writes. Root cause, with the two-second gap measured rather than
   assumed.

### Friction
- **The first fix was architecturally wrong and the linter said so.** Deriving the wait from
  `resumed` while the same effect writes `resumed` is a cascade; `react-hooks/set-state-in-effect`
  refused it, twice, through two attempted shapes. The third — a ref written only from effects and
  timers — leaves the latch effect with the same single `[room]` dependency it had before this
  task existed. Worth noting the rule is not in the root `npm run lint`, so a green root run
  proves nothing here.
- **`react-hooks/refs` also bans reading a ref during render**, which killed the
  read-the-marker-at-first-render version. The marker read moved into the effect that owns the
  poll, which is where it belonged.

### What I rejected and rewrote by hand
- **Making the notice follow `pendingTurn` live.** It fixes this in one line and reintroduces
  exactly what ADR-T05 argued against: a card that regrows with every probe, re-announcing raw
  Scribe output the candidate cannot correct. The wait is bounded and one-shot instead.
- **Polling `/state` for every room.** The marker means only the tab that actually sent a beacon
  pays for it, and only until the fragment lands or six seconds pass.
- **Blaming the gate for holding 6 of 6 uploads in that run.** It is a real number and it is not
  this task's; STATE.md's backlog already has the tuning task waiting on enough runs to say
  whether it is the prompt, the model, or Turkish.
