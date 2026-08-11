# Speech-latency — REFERENCE (read this once, then you don't need to spelunk)

Reflects the repo as of **2026-08-11**, after S10, C06 and the turn-taking ledger opening.
Written against the code and against live providers. If reality diverges, trust the code and
patch this file.

## Commands

```bash
docker compose up -d db cache
cd backend && npm install && npx prisma generate && npx prisma migrate deploy

npm test                                     # one vitest run; backend has no `test` script
npm test -- --project node speech
npm run -w frontend test -- use-voice-session

npm run lint && npm run typecheck
npm run -w frontend lint                     # stricter, NOT covered by the root run
```

## The measured baseline (2026-08-10/11)

Live providers, the repo's own `.env`. Model calls are warm medians over n=5.

| stage | ms | notes |
|---|---|---|
| VAD silence window | 2 000 | `VAD_SILENCE_MS`. Not a provider — the pause detector. **Largest single line** |
| upload | ~100–300 | a webm fragment |
| STT, whole file | ~1 650 | `scribe_v1`, ~11 s of audio |
| completeness gate | 780 | `gpt-4.1-nano` (turn-taking T01). min 556, max 887 |
| conductor | 1 180 | `gpt-4.1-mini`, **34 output tokens** — understated, see below |
| client refetch + `GET speech` | ~300 | two round trips |
| TTS, whole MP3 | ~1 130 | `eleven_multilingual_v2`, 132 chars |
| **total** | **~7 100** | |

### ⚠ Two things that will mislead you if you skip them

**Discard a warm-up call.** The first call in a process measured **1 883 ms** against a 780 ms
warm median — pure TLS setup. A benchmark without a discarded warm-up overstates by more than a
second, and a 1 883 ms gate looks like the biggest thing in the loop when it is nowhere near it.
This nearly sent the design in the wrong direction (ADR-L01).

**The conductor figure is understated.** It was measured with a toy prompt. Production carries the
persona brief, job listing, candidate profile, CV and up to 7 000 characters of conversation, and
time-to-first-token scales with input. L04 exists to find the real number.

## Findings

### Idle gaps do NOT cost a handshake — do not re-investigate (ADR-L02)

```
openai      cold (process start)  1 883 ms
openai      back-to-back            745, 684, 539 ms
openai      after  5 s idle          779 ms
openai      after 15 s idle          563 ms   ← fastest sample of the run
elevenlabs  after 15 s idle          829 ms   ← faster than back-to-back
```

A real interview leaves 10–20 s between calls and connections survive it. The cold number is
server boot, paid once. No keep-alive agent, no warm-up ping, no pooling work.

### TTS model — 3.3× in config, but the ear decides (ADR-L03)

| model | English | Turkish | bytes (tr) |
|---|---|---|---|
| `eleven_multilingual_v2` (shipping) | 1 024 ms | 936 ms | 82 799 |
| `eleven_turbo_v2_5` | **313 ms** | **310 ms** | 82 799 |
| `eleven_flash_v2_5` | 397 ms | 344 ms | 81 128 |

Turbo beat flash. The identical Turkish byte count between multilingual and turbo is odd enough
that the comparison should not be trusted until someone listens to both files.

### STT scales sub-linearly — ~500 ms fixed + ~35 ms per audio-second

| clip | audio | STT median | per audio-second |
|---|---|---|---|
| short | 2.2 s | 620 ms | 282 ms |
| medium | 4.9 s | 707 ms | 144 ms |
| long | 13.7 s | 960 ms | 70 ms |

Why it matters: with turn-taking's restart-before-upload, every fragment except the last is
transcribed while the candidate is still talking, so only the final fragment's STT is on the
critical path. A shorter `VAD_SILENCE_MS` makes that fragment short — 2 000 → 1 000 buys ~1 000 ms
of window plus ~250 ms of STT. Extra probes cost one nano call each and **no extra STT money**:
ElevenLabs bills per audio-minute and the total audio is unchanged.

## Anchors this ledger edits

### TTS (L01, L02)

| What | Where |
|---|---|
| Model ids, from config | `backend/src/lib/env.ts:53-55`, `.env` `ELEVENLABS_TTS_MODEL` |
| The driver | `backend/modules/speech/elevenlabs-speech.ts:34-71` `speak()` |
| The route and its guards | `backend/modules/speech/tts.ts` |
| **`serveSpeech` — the function L02 splits** | `tts.ts:107-160` |
| The double-checked read inside the budget lock | `tts.ts:130-135` |
| Message-keyed cache entry | `tts.ts:234` — `speech/msg-${message.id}.mp3`, already exists |
| Question-keyed cache entry | `tts.ts:196` |
| Metering | `backend/modules/speech/metering.ts`, prices in `packages/ai/config/model-prices.yaml` |

`tts.ts:100-106` is the comment that governs L02, and it should be read before the code is
touched: the subtle parts are the double-checked cache read inside the budget lock and serving
bytes that were already billed — *"a fix applied to one route and not the other is a bill the
candidate pays twice, and nothing goes red when it happens."*

### The turn response (L02)

| What | Where |
|---|---|
| `TurnResult` | `backend/modules/interview/conductor.ts:55` |
| Where an assistant row is written | `conductor.ts:759` `say()` — synthesis can start here |
| The two handlers that return it | `backend/modules/interview/turns.ts:17`, `backend/modules/speech/stt.ts:241` |
| The room discarding it today | `frontend/src/lib/use-voice-session.ts:209-238` |
| How pending assistant lines are derived | `use-voice-session.ts:288-291`, keyed on ids at `:160-163` |

### The silence window (L03)

`frontend/src/lib/use-voice-session.ts:32` `VAD_SILENCE_MS`. A frontend test asserts the exact
value (`use-voice-session.test.tsx:359`), so changing it means changing that assertion — which is
the intended tripwire, not an obstacle.

The two VAD effects at `:371-385` are load-bearing and documented: the window is polled from a
timestamp, **not** held in a `setTimeout` keyed to `mic.level`, because that effect is torn down
~60×/s and can never elapse. Do not "simplify" it while changing the constant.

### The conductor prompt (L04)

| What | Where |
|---|---|
| The prompt | `packages/ai/prompts/interview.conduct.turn.prompt.yaml` |
| Var builder and block order | `packages/ai/src/prompt-vars.ts:107` `conductVars`, `:126` `formatConversation` |
| History budget | `conductor.ts:69-80` — `MAX_HISTORY_CHARS = 7_000`, drop-oldest |
| Timeout | `packages/ai/src/AiClient.ts:34` — `conductTurn: 10_000` |

**§7.1 warning for L04:** the system block has **zero** placeholders and the builder rejects
otherwise (`AI_PROMPT_BUILD_FAILED`). Prefix caching wants stable content first and volatile
content last, but every candidate-influenced value must stay a bound value in the user block.
Reordering *within* the user block is safe; moving anything into the system block is not, whatever
it does for the cache.

## Also measured, not acted on

Recorded here because the spike that produced the latency numbers also produced this, and it
would otherwise be lost. **It belongs to the speech spec, not this ledger.**

The speech spec's Open question 1 recommends passing `language_code` to Scribe on the grounds
that *"auto-detect on a Turkish answer to an English question is exactly the failure I10/#149
already document"*. Tested:

| sample | `language_code` given | omitted |
|---|---|---|
| Turkish | `tur` p=1.000 | `tur` p=0.995, identical text |
| Turkish + English technical terms | `tur` p=1.000 | `tur` p=0.975, byte-identical |
| English | `eng` p=1.000 | `eng` p=0.938, identical |

And the case the recommendation was written for — Turkish audio with `language_code=en`, which is
what ships today while I10 waits for its two-turn streak — returned **correct Turkish**. Scribe
ignores a wrong `language_code` rather than being corrupted by it, and echoes the forced value
back as `language_code: eng`, so that field is untrustworthy whenever the parameter is passed.

Omitting it would give provider-grade `language_code` + `language_probability` on every turn,
free, which is better than I10's hand-rolled heuristic and its process-local streak `Map`. Not
acted on: the samples are TTS-clean audio with no accent variance, background noise or
mid-utterance code-switching. Re-run against a real noisy recording before changing anything.
