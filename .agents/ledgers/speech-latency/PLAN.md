# Speech-latency — PLAN (Architecture)

Written once. Amend only via a new `DECISIONS.md` ADR-L entry referenced here.

## Goal

When this ships, the gap between a candidate's last word and the interviewer's first sound is
short enough to read as a conversation rather than a form submission. Today it is ~7.1 seconds,
measured. The target is under four, without streaming anything and without making the
interviewer sound cheap.

Every claim in this ledger is a measurement or it is not a claim. The reason this ledger exists
separately from `turn-taking` is that "the speech system is too slow, we should stream it" was
half right in a way that only showed up when someone timed it.

## The invariant this initiative must not weaken

> Latency is never bought with correctness, money, or the interviewer's voice. Specifically: no
> optimisation may create a second synthesis path (that is a double charge), a second source of
> truth for interview state (that is K11), or a voice the owner would not ship.

And the process rule that makes the rest of it honest:

> Every task that claims a win records a measured before and after. A change made for latency
> that does not move latency is **reverted**, not kept because it is already written.

## Topology

Where the seconds are, and who owns each one:

```
candidate stops speaking
  │
  ├─ 2 000 ms  VAD silence window          L03 (safe to shorten only once the gate ships)
  ├─   ~200 ms upload                      —
  ├─ 1 650 ms  STT, whole file             turn-taking T04 moves all but the last off the path
  ├─   780 ms  completeness gate           turn-taking T01 — this ledger pays for it
  ├─ 1 180 ms  conductor                   L04 (measure the real prompt first)
  ├─   ~300 ms refetch /state, then GET    L02
  └─ 1 130 ms  TTS, whole MP3              L01 (model), #266 (streaming)
                                           = ~7 100 ms
```

Consumed, not re-implemented: the budget transaction and its advisory lock (I08), the TTS cache
and its double-checked read (S02), the speech provider seam (S01), the conductor (C02).

## Tasks

| ID | What |
|----|------|
| L01 | The TTS model: measure, **listen**, then swap or reject. `~700 ms` for one `.env` line |
| L02 | Assistant ids on the turn response, and synthesis begun when the row is written |
| L03 | Shorten `VAD_SILENCE_MS` — only once the gate exists and its accuracy is known |
| L04 | The conductor's real prompt: measure production-sized TTFT, then decide about prefix caching |

## Relationship to `turn-taking`

The two ledgers pull in opposite directions on the same files and must not be run concurrently:

- `turn-taking` T03 changes the turn response (`pendingTurn`); **L02 changes it again**
  (`spokenIds`). L02 depends on T03 for that reason, not because it needs the feature.
- `turn-taking` T04 rewrites the room's `onstop`; **L02 reads `spokenIds` inside it** and L03
  changes the constant its VAD reads. Both depend on T04.
- `turn-taking` adds 780 ms and says so. This ledger is where that is paid back.

**L01 and L04 are independent of turn-taking entirely** and can run today.

## What this ledger deliberately does not do

- **Streaming (#266).** Three separate projects, priced there. The pipelined conductor→TTS win
  (~1 700 ms) is real and wants its own ledger. Streaming STT (~1 650 ms) reverses ADR-S01 and
  would obsolete `turn-taking` outright — a live partial transcript carries its own
  end-of-utterance signal, so the gate, the held partial and the 13 s clock all stop existing.
  Declined by the owner 2026-08-10.
- **Tune the gate.** Its accuracy is turn-taking's business. This ledger only *consumes* the fact
  that a gate exists, which is what makes a shorter window safe.
- **Move the ceiling.** `max_duration_seconds` and the 13 s force-submit are not latency.
- **Optimise anything unmeasured.** Including the conductor prompt: L04 measures first and may
  conclude there is nothing to do.
