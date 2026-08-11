# Speech-latency — Recommended Model Per Task

Opus for the one task that spends money outside the request that serves its bytes. Sonnet for the
rest — this ledger is mostly measurement, config and one constant, and its failures are loud
rather than silent.

EXECUTE.md §5 is the rule — the tier must match the model actually running, or the session prints
`TIER <ID> needs <tier>, running <model>` and ends.

| ID | Title | Model | Why |
|----|-------|-------|-----|
| L01 | The TTS model: measure, listen, swap or reject | `claude-sonnet-5` | An `.env` value, a benchmark that already exists in REFERENCE.md, and audio samples rendered for a human to judge. The one thing that must not be automated away is the judgement itself — ADR-L03 makes the ear the decider, so there is no correctness call left for a model to get wrong. A bad outcome here is audible immediately |
| L02 | Assistant ids on the turn response, synthesis begun early | `claude-opus-5` | Money, and the quiet kind. It fires a **paid** TTS call outside the request that serves its bytes, racing the client's own GET for the same audio. `tts.ts:100-106` already says what goes wrong: "a fix applied to one route and not the other is a bill the candidate pays twice, and nothing goes red when it happens." The task is largely an extraction, and an extraction that quietly drops the double-checked read inside the budget lock passes every test it has |
| L03 | Shorten `VAD_SILENCE_MS` behind the gate | `claude-sonnet-5` | One constant and one test assertion. The judgement — whether the gate is accurate enough to make a short window safe — is a precondition stated in ADR-L04 and checked with data, not something the session decides. If it is wrong the candidate is interrupted mid-sentence on the first try, which is as loud as a failure gets |
| L04 | The conductor's real prompt: measure, then decide | `claude-sonnet-5` | Measurement first and possibly no change at all. The one hazard is §7.1: prefix caching wants stable content first, and a session that "optimises" by moving a candidate-influenced value into the system block breaks the trust boundary — but the builder rejects that outright with `AI_PROMPT_BUILD_FAILED`, so the guard is mechanical rather than a matter of care |

## Summary

- **`claude-opus-5` (1 task):** L02
- **`claude-sonnet-5` (3 tasks):** L01, L03, L04

Rule of thumb for this ledger: **if it can overcharge a candidate without going red, it is
opus.** Everything else here fails audibly — a wrong voice, an interruption, a number that did
not move — and the process rule in ADR-L01 catches the last of those: a change made for latency
that does not move latency is reverted, not kept.
