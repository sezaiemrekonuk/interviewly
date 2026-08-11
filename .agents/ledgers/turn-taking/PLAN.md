# Turn-taking — PLAN (Architecture)

Written once. Amend only via a new `DECISIONS.md` ADR-T entry referenced here.

## Goal

When this ships, a candidate can stop mid-sentence to think and the interviewer waits. A pause
is not an answer. What reaches the conductor is a finished thought, however many pauses it took
to say — one `chat_messages` row, not three fragments the interviewer replied to in turn. A
candidate who genuinely has nothing more to say is not left in silence either: after thirteen
seconds the interviewer speaks, and what it says is its own decision, not a client-side jump to
the next question.

What it must not become is an interviewer that never speaks. Every mechanism here either ends
the turn or is itself bounded by something that does.

## The invariant this initiative must not weaken

> The candidate's turn always ends. The gate may only *delay* a submission, never prevent one:
> the 13-second clock, the 8-probe cap and the 6 000-character cap each end the turn on their
> own, and a gate that cannot answer forwards rather than holds.

The second invariant, inherited and equally load-bearing:

> The voice route never accepts candidate text. A voice transcript is provider output by
> construction — the candidate speaks, Scribe transcribes, the conductor sees only what came
> back. Anything held between fragments is held server-side under a server-derived key.

## Topology

```
Browser (use-voice-session.ts)
  │  VAD 2 s  ─ stop('probe')  ─ restart recorder ─ upload            ─┐
  │  Stop button ─ stop('final') ─ upload force=1                     ─┤→ POST /turns/audio
  │  13 s clock  ─ POST /turns { kind: 'silence' }                    ─┘
  ▼
stt.ts  submitTurnAudio
  ├─ takePendingTurn()      ← redis, MULTI GET+DEL, questionId-checked   (ADR-T02)
  ├─ transcribeRecording()  → ElevenLabs Scribe, metered                 (S01/S04, unchanged)
  ├─ turnComplete()         → gpt-4.1-nano, no tier-2, fail open         (ADR-T03)
  ├─ finished:false → holdPendingTurn() → 200 { pendingTurn }            (ADR-T02)
  └─ finished:true  → conductTurn(joined)                                (C02, unchanged)

conductor.ts  runTurn
  └─ kind: 'silence' → role='system', action='silence' row               (ADR-T04)
                       counted by BOTH ceilings, invisible to the room

state.ts  getInterviewState
  └─ pendingTurn (plain GET, questionId-matched, never consumed)         (ADR-T05)
```

Consumed, not re-implemented: the speech provider seam (S01), STT metering and the budget
transaction (S04/I08), the conductor and its five guards (C02), the state machine (I07), the
guarded advance (I06), and the shared Redis connection (`auth/rate-limit.ts`).

## Tasks

| ID | What |
|----|------|
| T01 | The gate: `interview.turn.complete` prompt, `TurnCompleteSchema`, `turnComplete` on the seam, the opted-out chain, fail-open |
| T02 | The held partial: `pending-turn.ts` over the shared Redis client, atomic take, the two caps |
| T03 | The turn paths: gate + join + hold in `submitTurnAudio`, `kind: 'silence'`, both ceilings, `pendingTurn` on `/state`, silence hidden from the room |
| T04 | The room: probe-vs-final stop, restart-before-upload, the 13 s clock, the recovery notice |

## What this ledger deliberately does not do

- **Streaming STT or a realtime socket.** The loop stays discrete (ADR-S01, ADR-S06). This makes
  the discrete loop tolerant of pauses; it does not replace it. A true streaming transcript would
  make the gate unnecessary and is a different architecture. See #266 and `speech-latency` ADR-L05.
- **Latency.** The room takes ~7.1 s from a candidate's last word to the interviewer's first
  sound, and this ledger's gate is 780 ms of it. `.agents/ledgers/speech-latency/` owns that
  problem and pays the gate back. The one number the two ledgers share is `VAD_SILENCE_MS`:
  ADR-T01 argued a gate makes a short window safe, and `L03` is where it actually shortens —
  after `T04`, and only once the gate's accuracy is known.
- **Gate the typed path.** Pressing Send is already an explicit finished signal. Gating it would
  make Send mean "maybe send".
- **Judge answer quality.** The gate decides whether the speaker stopped talking, nothing else.
  Whether the answer is any good is `interview.answer.score`'s job (D03) and whether it needs a
  follow-up is the conductor's (C02).
- **Tune the numbers.** 2 s and 13 s are guesses, exactly as ADR-S06's 2 s was. They move when
  someone hears them being wrong, not before.
- **Survive a server restart.** The held partial is a 300 s scratch value. Losing it costs half a
  sentence and the candidate says it again; that is the whole reason it is allowed in Redis at
  all (ADR-T02).
