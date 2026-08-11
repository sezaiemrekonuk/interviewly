# speech-latency — spec

**Date:** 2026-08-11
**Status:** draft
**Derives from:** IDEA.md §3.2 (the turn loop), K13 (cost txn), ADR-S01 (no realtime socket)
**Related:** `2026-08-10-turn-taking.md` (owns the pause, not the latency), issue #266 (streaming)

## Scope

A candidate finishes speaking and waits **~7.1 seconds** before hearing anything back. Measured
against live providers, not estimated. That is the length of an uncomfortable silence in a
conversation whose entire premise is rehearsing a conversation.

This ledger owns the seconds. It does not own the pause — `turn-taking` owns what happens when a
candidate stops mid-thought, and the two ledgers touch the same files in opposite directions:
turn-taking *adds* 780 ms (its completeness gate) in exchange for not interrupting people, and
this one takes more than that back.

Owns: the TTS model choice, the round trips between the conductor finishing and audio being
requested, the silence window now that a gate makes a short one safe, and the conductor's
prompt shape where it affects time-to-first-token.

Does not own: streaming anything (#266), the completeness gate itself (turn-taking T01), the
budget transaction (I08), the speech provider seam (S01), or the conductor's decisions (C02).

## The measured baseline

Live providers, the repo's `.env`, 2026-08-10/11. Model calls are warm medians over n=5.

| stage | ms | notes |
|---|---|---|
| VAD silence window | 2 000 | `VAD_SILENCE_MS`. Not a provider — this is the pause detector |
| upload | ~100–300 | a webm fragment, small |
| STT, whole file | ~1 650 | `scribe_v1`, ~11 s of audio |
| completeness gate | 780 | `gpt-4.1-nano` (turn-taking). Min 556, max 887 |
| conductor | 1 180 | `gpt-4.1-mini`, **34 output tokens** — and see the caveat below |
| client refetch + `GET speech` | ~300 | two round trips |
| TTS, whole MP3 | ~1 130 | `eleven_multilingual_v2`, 132 chars |
| **total** | **~7 100** | |

**Measurement rule, non-negotiable:** discard a warm-up call. The first call in a process
measured **1 883 ms** against a 780 ms warm median. Any benchmark that skips the warm-up
overstates by more than a second and will send someone optimising the wrong thing.

**Caveat on the conductor number:** it was measured with a toy prompt. The real one carries the
persona brief, job listing, candidate profile, CV and up to 7 000 characters of conversation.
Time-to-first-token scales with input, so the production figure is worse than 1 180 ms by an
unmeasured amount. L04 exists to find out.

## Findings that decide what is worth doing

### 1. Idle gaps do not cost a handshake — hypothesis rejected

A real interview leaves 10–20 s between provider calls, and connection pooling could have been
going cold in between. It is not:

```
openai  cold (process start)  1 883 ms
openai  back-to-back            745, 684, 539 ms
openai  after  5 s idle          779 ms
openai  after 15 s idle          563 ms   ← fastest of all
elevenlabs after 15 s idle       829 ms   ← faster than back-to-back
```

Connections are reused across the gaps that matter. The cold number is server boot, paid once.
Recorded so nobody re-runs this.

### 2. The TTS model is a config value, and the fast ones are 3× faster

| model | English | Turkish |
|---|---|---|
| `eleven_multilingual_v2` (shipping) | 1 024 ms | 936 ms |
| **`eleven_turbo_v2_5`** | **313 ms** | **310 ms** |
| `eleven_flash_v2_5` | 397 ms | 344 ms |

~700 ms, for one line of `.env` — more than streaming TTS would buy. S01 made the model id
config precisely so this is a config decision.

**This is not a free win, and the task must not treat it as one.** Turbo and flash trade quality
for speed, and the artefact in question is the interviewer's voice — the one thing in the product
that cannot sound cheap. The Turkish byte counts also came back identical between multilingual
and turbo (82 799), which is odd enough to distrust the comparison until someone listens.

### 3. STT has a fixed floor, which changes the silence-window maths

| clip | audio | STT | per audio-second |
|---|---|---|---|
| short | 2.2 s | 620 ms | 282 ms |
| medium | 4.9 s | 707 ms | 144 ms |
| long | 13.7 s | 960 ms | 70 ms |

Roughly 500 ms fixed plus ~35 ms per audio-second. Shortening a clip saves less than
proportionally — but combined with turn-taking's restart-before-upload, **every fragment except
the last is transcribed while the candidate is still talking**, so only the final fragment's STT
is on the critical path, and a shorter window makes that fragment short.

`VAD_SILENCE_MS` 2 000 → 1 000 therefore buys ~1 000 ms of window plus ~250 ms of STT. Extra
probes cost one nano call each and no extra STT money — ElevenLabs bills per audio-minute and the
total audio is unchanged.

This is what ADR-T01 argued for without following through: *"with a gate behind it, a short
window costs a round trip and a long one is latency on every finished answer."*

## Contracts

| Change | Where | Expected |
|---|---|---|
| TTS model | `ELEVENLABS_TTS_MODEL` in `.env` / `env.ts:53-55` | ~700 ms |
| Assistant ids on the turn response | `TurnResult`, `stt.ts`, `turns.ts` | ~300 ms |
| Synthesis begins when the row is written | `conductor.ts` `say()`, `tts.ts` | up to ~500 ms |
| `VAD_SILENCE_MS` | `use-voice-session.ts:32` | ~1 250 ms |
| Conductor prompt ordering | `prompt-vars.ts`, the prompt YAML | unmeasured |

## Failure modes

| Condition | Effect |
|---|---|
| Eager synthesis fails (budget, provider, storage) | Logged and swallowed. The client's own `GET` is still the path that reports failure, with S10's copy |
| Eager synthesis races the client's `GET` | Budget lock + the re-read inside it (`tts.ts:130-135`) — one charge. This is why the synthesis half must be *extracted*, not duplicated |
| A faster TTS model mispronounces Turkish | Reject the swap. Latency is not worth an interviewer who sounds wrong |
| A shorter window interrupts people | The gate is what makes the window safe; if accuracy is not there, the window does not move |

## Security

Nothing here changes a trust boundary. The assistant ids on the turn response are a latency
shortcut and **not** a second source of truth — K11 holds, and `GET /state` still reconciles. No
new client-supplied input on any voice route.

## Open questions

1. **Does a faster TTS model sound acceptable, in Turkish and English?** **Decides:** the owner,
   by listening at L01. **Blocks:** the biggest single cheap win. **Recommended default:**
   `eleven_turbo_v2_5` if it passes the ear test, otherwise stay and take the loss.
2. **How accurate is the completeness gate on real, noisy speech?** **Decides:** this ledger at
   L03, with data from turn-taking in production. **Blocks:** the silence-window change and
   nothing else. **Recommended default:** do not shorten the window on faith.
3. **How much worse is the conductor with a production-sized prompt, and does prefix caching
   help?** **Decides:** L04, by measuring. **Blocks:** nothing. **Recommended default:** measure
   before reordering anything — the §7.1 boundary is not worth risking for an unquantified win.

## Acceptance criteria

1. The measured baseline is reproducible from the script in this ledger, and every benchmark in
   it discards a warm-up call.
2. A TTS model change is a `.env` edit and nothing else — no code change is required to try one.
3. The turn response carries the ids of the assistant rows it wrote; the room uses them to start
   fetching audio without waiting for a `/state` refetch, and still reconciles from `/state`.
4. Two concurrent synthesises of the same message produce exactly **one** `llm_calls` row.
5. An eager synthesis failure leaves the turn successful and the candidate's next `GET` behaving
   exactly as it does today.
6. The existing `tts.test.ts` passes unedited after the synthesis half is extracted — the proof
   the extraction changed no behaviour.
7. Every task that claims a latency win records a measured before and after in its `## Notes`. A
   change made for latency that does not move latency is reverted, not kept.
8. End to end, a spoken turn is measurably faster than the 7.1 s baseline, measured the same way.
