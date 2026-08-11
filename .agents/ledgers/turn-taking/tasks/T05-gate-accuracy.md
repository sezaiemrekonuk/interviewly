# T05 — The gate holds finished answers: two clocks and a stricter prompt
REPO: (this repo) · Depends: T04 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — it moves the number that guarantees *the turn always ends*. A second
clock is a second way to leave a candidate waiting on an interviewer that will never speak, which
is MODELS.md's own line for what opus is for.

## Goal
Owner's ask, after the first live run (2026-08-11):

> "even though i was done talking it still waited for me to talk maybe we can decrease max
> thinking time that could be solution or improve agent for it to understand when the interview
> is over"

Both, chosen by the owner over either alone.

**Measured, same run** (`interviewly-api-1`, four uploads): `CONDUCTOR_TURN_HELD` on three of
them, at 134, 111 and 142 characters. A wrong hold costs the candidate ~16 s of silence — 2 s VAD
+ ~0.8 s gate + the 13 s clock, which is the only exit once the gate has held.

## Non-negotiables
- **The turn always ends.** Two clocks is two chances to get that wrong. Whichever branch runs,
  a turn must still be submitted with no candidate action.
- **The thinking window is not what shrinks.** A candidate who has said *nothing* still gets
  13 s. Only a turn the server is already **holding** a fragment for flushes early: they have
  spoken, they have paused, and the gate has already had its say.
- **`VAD_SILENCE_MS` stays 2 000.** `speech-latency` `L03` owns that number, not this task.
- **The room still asserts nothing (K11).** It sends "time has passed" earlier. The server
  decides what that means, exactly as ADR-T04 has it.
- **K9 for the prompt: a new FILE, same `uuid`, `version: 2`.** Never edit v1 —
  `registry.ts:65-75` resolves the highest version, so shipping v2 is what switches it, and v1
  stays as the record of what the first live run was judged by.
- **The gate stays nano, chainless and fail-open** (ADR-T03). This changes what it is asked, not
  what it is or what happens when it cannot answer.

## Context (anchors)
- `frontend/src/lib/use-voice-session.ts:56` `FORCE_SUBMIT_MS` · `:508-535` the clock effect
  (`silenceSentRef`/`uploadingRef` guards, the `heardRef ? lastLoudRef : turnStartedRef` anchor)
  · `holding` state, set from the upload's `pendingTurn`.
- `frontend/src/lib/use-voice-session.test.tsx:560+` the T04 fake-timer block — `toFake` lists
  timers and `Date` only, deliberately (faking `requestAnimationFrame` takes the meter away from
  `audio.level()` and the VAD then reads nothing).
- `packages/ai/prompts/interview.turn.complete.prompt.yaml` — v1, `uuid`
  `7e95e529-c2a6-4fec-88c8-0a07e5bfb2dd`, `gpt-4.1-nano`, `temperature: 0`, `max_tokens: 30`.
- `packages/ai/src/registry.ts:65-75` `resolve(name)` → highest version.
- `packages/ai/src/turn-complete.test.ts` — the seam's tests, stub and live.
- `packages/ai/src/stub.ts:221-230` `UNFINISHED_TAIL`, the offline heuristic. Unchanged here, but
  it is the shape the prompt is trying to describe in words.
- `backend/modules/speech/stt.ts:335-350` `gated` and the hold. Server side does not change.

## Steps
- [x] **1. Test red, the clock.** In the T04 fake-timer block: a turn with a held fragment
  submits its silence turn at `FLUSH_HELD_MS`, and a turn nothing was ever said into still waits
  the full `FORCE_SUBMIT_MS`. Both fire exactly once. See them red.
- [x] **2. `FLUSH_HELD_MS = 4_000`**, exported beside `FORCE_SUBMIT_MS`, and the clock effect
  reads `holding ? FLUSH_HELD_MS : FORCE_SUBMIT_MS`. Same anchor, same guards, same submission —
  one threshold, chosen per branch. Note that the gate round trip is inside the window, so the
  candidate's real grace after the verdict is ~3 s.
- [x] **3. Prompt v2.** New file, `version: 2`, same `uuid` and `name`. What v1 got wrong on
  Turkish speech: it lists what "unfinished looks like" in more detail than what finished looks
  like, and a transcript with no punctuation reads as dangling far more often than it is. v2
  leads with the default — **a clause with a subject and a verb is finished** — and holds only on
  an explicit dangling marker. Keep the injection clause, the JSON-only instruction, `temperature: 0`.
- [x] **4. Cases for it** in `turn-complete.test.ts`: the three lengths this run held (a complete
  Turkish sentence of ~130 characters is the shape to assert) come back `finished: true`, and a
  trailing "ve"/"çünkü" still comes back false.
- [x] **5. Telemetry, cheaply.** The backlog wants gate accuracy on Turkish and there is still no
  data: log the verdict beside the length that already goes in `CONDUCTOR_TURN_HELD`, and add the
  same line for the *finished* branch. Length and verdict only — K6, never the text.

## Definition of done
- A held fragment flushes ~4 s after the candidate stops, not ~13 s.
- A turn with nothing said still waits 13 s.
- turn-taking AC-8 and AC-10 still green; the T04 block still green.
- `npm run -w frontend lint` passes — the root lint does not cover that config.

## Verification
```bash
npm run -w frontend test -- use-voice-session
npm test -- --project node turn-complete
npm run -w frontend lint
npm run lint && npm run typecheck && npm test
```
Then, in the real room with `AI_ENABLED=true` and live keys — the only check that matters here,
because the number this task moves was chosen by hearing it be wrong:
- give three finished answers of ordinary length → count `CONDUCTOR_TURN_HELD` in the API log.
  Fewer than one in three is the bar; three in four was the failure.
- pause deliberately mid-sentence → still one joined user row, not two.
- say nothing at all → the interviewer still nudges at ~13 s, not at 4.

## Notes

**What shipped.** `FLUSH_HELD_MS = 4_000` beside `FORCE_SUBMIT_MS`; the clock effect reads
`holding ? FLUSH_HELD_MS : FORCE_SUBMIT_MS` and gained `holding` as a dependency — same anchor,
same `silenceSentRef`/`uploadingRef` guards, same submission. Prompt
`interview.turn.complete.v2.prompt.yaml` (same uuid, `version: 2`) leads with "Default to
FINISHED" and names the transcript trap outright: a missing full stop is not a break.
`CONDUCTOR_TURN_FORWARDED` logs `chars`, `probes`, `gated`, `finished` on the branch that does
not hold, so the hold rate is now countable from one grep instead of inferable from a silence.

**Deviation — the gate's live accuracy is still unmeasured.** Step 4 asked for cases proving a
~130-character Turkish sentence comes back finished, and the seam's tests stub the transport:
they can assert the wire, never the model's judgement. What they assert instead is the K9
contract — v2 is served, on v1's uuid, on nano, at temperature 0 — plus the two sentences the
revision exists for. The real check is the manual one under `## Verification`, and it has **not
been run**. Until it is, the prompt half of this task is a hypothesis with a test suite around
it, not a fix.

**Acceptance skipped, not green.** The stack is up under plain `docker compose up`, which
publishes no host ports, so the suite could not reach db or cache. It was green (111 scenarios)
on this branch 40 minutes earlier, before the one backend change here — the
`CONDUCTOR_TURN_FORWARDED` line and the `finished` hoist, both covered by `stt.test.ts` (28
passed). To run it: `docker compose -f compose.yaml -f compose.dev.yaml up -d`, then
`DATABASE_URL=…interviewly_test REDIS_URL=…/9 npm run test:acceptance`.

**The number to check next.** 4 s is measured from the recorder re-opening, and the gate round
trip is inside it, so the candidate's real grace after a verdict is ~3 s. If that turns out to
clip people who pause twice in one sentence, anchor the flush at the moment `holding` became
true rather than at the restart — that is the seam, and it costs one ref.

## Verification output

`npm run -w frontend test -- use-voice-session` → 31 passed. `npm test -- --project node
turn-complete` → 10 passed. Root `npm test` → 1116 passed (109 files), up from 1112.
`npm run lint`, `npm run -w frontend lint`, `npm run typecheck` clean. `npm run test:acceptance`
**skipped** — see above.

Both clocks were asserted independently rather than as one branch: a held fragment flushes at
`FLUSH_HELD_MS` and not before, a turn nothing was said into is still silent at
`FLUSH_HELD_MS + 200` and submits at `FORCE_SUBMIT_MS`, and both fire exactly once across a
further `FORCE_SUBMIT_MS * 2`.
