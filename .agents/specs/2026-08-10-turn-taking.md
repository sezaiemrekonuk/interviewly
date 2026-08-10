# turn-taking — spec

**Date:** 2026-08-10
**Status:** draft
**Derives from:** IDEA.md K11 (the room asserts nothing), K6 (log hygiene), K13 (cost txn), §3.2, §3.8, §7.1
**Supersedes:** ADR-S06's silence rule (`.agents/specs/2026-08-06-speech.md` *The turn loop*, Open question 2)

## Scope

A candidate who pauses to think is not a candidate who has finished. Today the room's only
turn-end signal is acoustic silence: two seconds below the RMS threshold stops the recorder, and
whatever was captured is submitted as a whole turn. A thought interrupted mid-sentence is
answered by the interviewer, and the rest of the sentence is never said.

This ledger separates **stopping the recorder** from **ending the turn**. The recorder still
stops on silence — that is what bounds the audio and it works. What changes is what happens
next: the fragment is transcribed, a cheap model decides whether the speaker sounds finished,
and only a *finished* utterance reaches the conductor. An unfinished one is held server-side and
the mic reopens with nothing said. Thirteen seconds of continuous silence ends the turn whatever
the model thinks.

Owns: the completeness gate (prompt, seam method, fail-open policy), the held-partial store and
its caps, the silence turn, the recorder's probe/final split, the 13-second ceiling, and the
recovery notice in the room.

Does not own: the K2 state machine (I07), the guarded advance (I06), the budget transaction
(I08), the `SpeechProvider` seam (S01), the conductor's own decision-making (C02), or the
adaptive selector (D01–D03). All are consumed unchanged.

## Contracts

### The gate

`AiClient.turnComplete({ utterance, currentQuestion, language, ctx })` → `{ finished: boolean }`.

- Prompt `interview.turn.complete` v1, `openai/gpt-4.1-nano`, `temperature 0`, `max_tokens 30`.
- `TIMEOUT_MS.turnComplete = 3_000`.
- **No tier-2 fallback step.** Every other prompt appends `google/gemini-2.5-flash`; this one
  does not. It sits *in front of* the 10 s `conductTurn`, so a retry costs a 3 s timeout plus a
  full second attempt before the candidate hears anything.
- **Fail open.** Any throw, timeout, malformed output or `BudgetExceeded` is treated as
  `finished: true`. A dead gate degrades to exactly today's product; it must never be the thing
  that strands a candidate mid-interview.

The question it answers is **"has this speaker finished a thought"**, not "have they answered".
A refusal, a counter-question, a one-word reply and an off-topic reply are all *finished* and
belong to the conductor, which already handles them. Judging answer-quality here would mute the
interviewer on precisely the turns that need it.

### The held partial

Redis, `interview:{interviewId}:pending-turn`, value `{ text, questionId, probes }`, TTL 300 s.

- The key is derived from the route param **after** the ownership guard. No client-controlled
  component.
- `takePendingTurn` is a read-and-delete (`MULTI GET + DEL`). Two uploads racing cannot both
  consume the same partial.
- Every turn submission takes the buffer first. Only a not-finished verdict writes it back.
- A partial whose `questionId` no longer matches the current question row is discarded, never
  joined.
- `probes >= 8` or `text.length > 6_000` skips the gate and forwards. Both counters live in the
  stored value, so a client cannot reset them.

### The wire

`POST /interviews/:id/turns/audio` gains exactly one multipart field, `force`, literal `'1'`.
**It never accepts text.** The response gains `pendingTurn: string | null` — non-null means the
utterance was held and no turn was conducted.

`POST /interviews/:id/turns` gains `kind: 'utterance' | 'silence'`, default `'utterance'`. A
`silence` request with a held partial for the current question is conducted as an ordinary
utterance carrying that text; with no partial it is a real silence.

`GET /interviews/:id/state` gains `pendingTurn: string | null`, surfaced only when the stored
`questionId` matches the current question row, read with a plain `GET` that never consumes.

### The room

| Constant | Value | Meaning |
|---|---|---|
| `VAD_SILENCE_MS` | `2_000` | unchanged — the gate is what now prevents premature cutoff |
| `FORCE_SUBMIT_MS` | `13_000` | continuous silence that ends the turn regardless |

The 13 s clock is anchored to the **last loud frame**, or to the moment the mic opened if nothing
was ever heard. Probe round-trips do not extend it.

A probe stop restarts the recorder **before** the upload, so speech during the round-trip is
captured. Phase stays `listening` throughout — only a real submit reaches `uploading`.

## Behaviour

```
t=0.0  mic opens                                    listening
t=2.4  "So at my last company we"                   VAD arms
t=4.4  2 s silence: stop, restart, upload           still listening
t=4.9  STT + gate -> finished:false                 held; nothing said to the candidate
t=7.1  "...we rebuilt the ingest pipeline."         captured, nothing lost
t=9.1  2 s silence: stop, restart, upload
t=9.6  gate -> finished:true                        conductTurn(joined); one user row, not two
```

Silent throughout: no fragment is ever uploaded (the VAD never arms), and at t=13.0 the room
sends a silence turn — no audio, no STT. The conductor decides whether to nudge or move on.

Stopped mid-thought then silent: the same signal at 13 s, and the server flushes the held partial
as an ordinary turn instead. The room never has to know which case it is in.

## Failure modes

| Condition | Code / effect |
|---|---|
| Gate throws, times out, or returns malformed output | none — `finished: true`, forwarded |
| Gate trips the budget | none — `finished: true`, forwarded; the conductor's own `withBudget` still ends the interview if it must |
| Empty transcript from a probe fragment | no gate call, partial re-held unchanged, keep listening |
| Held partial belongs to a past question | discarded, never joined; TTL collects the key |
| Two uploads race | `takePendingTurn` is atomic — one consumes, the other sees nothing |
| Gate stuck on `false` | 8-probe cap, 6 000-char cap, and the 13 s clock all end the turn |
| Redis unreachable | treat as no held partial: the fragment is gated on its own and forwarded on `finished` |
| Manual Stop | `force: '1'`, gate skipped, always submits |

## Observability

- `CONDUCTOR_TURN_GATE_FAILED` — the gate could not answer and the turn was forwarded.
- `CONDUCTOR_TURN_HELD` — a fragment was held; carries `probes` and the held length, **never the
  text** (K6: the held partial is candidate speech).
- `CONDUCTOR_SILENCE_TURN` — a 13 s silence reached the conductor with nothing held.
- The existing `SPEECH_STT_TRANSCRIBED` still fires per fragment, so a turn made of three
  fragments logs three times — which is the truth about what was billed.

## Security

- **The voice route never accepts candidate text.** This is the reason the buffer is server-side
  rather than round-tripped through the client. A `pending` field on the wire would let a
  candidate post words they never spoke into the utterance the conductor answers, the transcript
  records and the report scores, while paying for a fraction of a second of audio. The only
  field the route accepts is `force`, and all `force` can buy is skipping a gate the candidate
  could skip anyway by waiting 13 s.
- The loop counters live in the stored value, out of the client's reach.
- ADR-S07 is unchanged: audio is a memory buffer for one request. The held partial is
  **transcript text**, never audio, and is never logged.
- §7.1 is unchanged: the joined text reaches the conductor only through `turnInputSchema`, and
  the existing injection scan runs on it as before.

## Open questions

1. **Gate accuracy on Turkish.** `gpt-4.1-nano` deciding sentence-completion on Turkish speech
   is unmeasured. **Decides:** this ledger, at T01, by trying it. **Blocks:** nothing — a wrong
   `finished: true` is today's behaviour and a wrong `finished: false` is caught by the 13 s
   clock. **Recommended default:** ship it, and log verdicts against fragment text length so the
   error rate is measurable before it is tuned.
2. **13 s as the patience ceiling.** A guess, like the 2 s before it. **Decides:** this ledger,
   by hearing it. **Blocks:** nothing. **Recommended default:** 13 s, and move it to config only
   if a real candidate complains.
3. **Whether a held partial should survive a question advance.** Currently discarded.
   **Decides:** this ledger. **Recommended default:** discard — a thought aimed at a question the
   interview has left is not an answer to the one it is on.

## Acceptance criteria

1. A recording whose transcript the gate calls unfinished creates **no** `chat_messages` row,
   makes **no** `conductTurn` call, does not move `current_index`, and returns
   `pendingTurn` equal to the joined text.
2. A second recording after an unfinished verdict is conducted as **one** user row containing
   both fragments joined, not two rows.
3. `POST /interviews/:id/turns/audio` with any multipart text field is refused; the route accepts
   only `audio` and `force`.
4. A gate that throws, times out or returns malformed output forwards the utterance to the
   conductor and logs `CONDUCTOR_TURN_GATE_FAILED`.
5. A held partial is consumed exactly once: two concurrent uploads produce one conducted turn
   carrying it, never two.
6. A held partial whose stored `questionId` differs from the current question row is neither
   joined nor surfaced by `GET /state`.
7. `GET /interviews/:id/state` returns the held partial without consuming it — two consecutive
   reads return the same text.
8. Thirteen seconds of silence with nothing said writes a `role='system'`, `action='silence'`
   row and calls the conductor; the row does **not** appear in `GET /state`'s `messages[]`,
   while candidate rows (`action: null`) still do.
9. Silence rows count toward both `CONDUCTOR_MAX_TURNS` and the per-question ceiling, so repeated
   silence on one question trips the existing forced-`drift` advance rather than looping.
10. Thirteen seconds of silence **with** a held partial conducts that partial as an ordinary
    utterance turn, and writes no silence row.
11. Manual Stop submits immediately: the gate is not called and the turn is conducted whatever
    the transcript looks like.
12. After a reload mid-turn, the room renders the held partial once as a recovery notice; the
    notice does not change as later probes extend the held text, and it is gone once the turn is
    conducted.
13. The recovery notice is rendered outside the `aria-live` conversation list, so a growing
    partial is never re-announced.
14. No log line, error body or test fixture contains held-partial text.
