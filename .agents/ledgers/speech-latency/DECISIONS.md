# Speech-latency — Decisions (append-only ADR log)

Never edit past entries. Supersede with a new dated entry referencing the one it changes.
Prefix `ADR-L` to avoid collision with foundations (`ADR-F`), auth (`ADR-A`), interview-core
(`ADR-I`), adaptive (`ADR-D`), speech (`ADR-S`), voice (`ADR-V`), conductor (`ADR-C`),
turn-taking (`ADR-T`) and every other ledger.

The ledger exists because of a suggestion that was half right: *"the speech system is too slow,
we should stream it."* The room is slow — ~7.1 s from a candidate's last word to the
interviewer's first sound. But streaming turned out to be neither the first nor the cheapest fix,
and the only way to know that was to time it.

---

## ADR-L01 — 2026-08-11 — Latency is measured, warm, or it is not discussed

**Context:** The opening claim was "it's too slow, stream it". Both halves needed testing. The
first attempt at a benchmark produced 1 850 ms for a `gpt-4.1-nano` call that turns out to take
780 ms — because the first call in a process pays TLS setup, and nothing discarded it.

That near-miss would have been expensive in a specific way: a 1 850 ms gate looks like the
biggest thing in the loop and would have sent someone rewriting the design around it.

**Decision:** Every latency number in this ledger is a warm median over n≥5 with a discarded
warm-up call, taken against live providers. Estimates are labelled as estimates. Every task that
claims a win records a measured before and after in its `## Notes`, and a change made for latency
that does not move latency is reverted rather than kept.

**Consequences:** The baseline table lives in REFERENCE.md with its method attached, and the
script that produced it is in the issue (#266) so the numbers are falsifiable rather than
folklore. One hypothesis has already been killed this way — see ADR-L02.

---

## ADR-L02 — 2026-08-11 — Connection pooling is not the problem; the hypothesis is recorded as dead

**Context:** The 1 883 ms cold vs 780 ms warm gap suggested that a real interview — which leaves
10–20 s between provider calls — might be paying a TLS handshake on every call, four times a
turn. That would have been the largest and cheapest win available.

**Decision:** Rejected on measurement. After a 15 s idle gap, OpenAI answered in 563 ms — the
fastest sample of the whole run — and ElevenLabs in 829 ms, faster than back-to-back. Connections
are reused across the gaps that matter. The cold number is process start, i.e. server boot, paid
once and never on a candidate's critical path.

**Why it is written down anyway:** a plausible, cheap, wrong idea will be re-proposed by the next
person who sees the cold number in a log. This entry is what stops it being re-investigated.

**Consequences:** No keep-alive agent, no warm-up ping, no connection pooling work. The cold
figure stays in REFERENCE.md **with its explanation attached**, because a bare 1 883 ms in a
table is exactly what caused the confusion.

---

## ADR-L03 — 2026-08-11 — The TTS model is a config decision the owner's ear settles, not a benchmark

**Context:** `eleven_turbo_v2_5` renders the same reply in 313 ms against `eleven_multilingual_v2`'s
1 024 ms — 3.3× faster on English and Turkish alike, and more than streaming TTS would buy. S01
already made the model id an environment variable, so trying one costs a `.env` edit.

**Decision:** The swap is **not** made on the benchmark. L01 must produce audio from both models,
in both languages, and the owner decides by listening. Latency loses if the faster model
mispronounces Turkish or sounds synthetic.

The reason is that the artefact is the interviewer's voice. It is the one surface in this product
that carries the illusion the whole thing depends on — a candidate rehearsing for a real
interview is not helped by 700 ms saved and a voice that sounds like a phone tree.

**Corroborating suspicion:** the Turkish outputs from `multilingual_v2` and `turbo_v2_5` came back
with byte-identical lengths (82 799). Two different models producing exactly the same MP3 size is
not impossible, but it is unlikely enough that the comparison should not be trusted until someone
has heard both files.

**Consequences:** L01 ships audio samples, not a table. If the owner rejects the swap, the ~700 ms
stays on the clock and #266's streaming TTS becomes the only route to it — that is an acceptable
outcome and the task must say so rather than quietly swapping anyway.

---

## ADR-L04 — 2026-08-11 — The silence window belongs to this ledger, and moves only behind the gate

**Context:** `VAD_SILENCE_MS` is 2 000 ms — the single largest line in the budget, larger than any
provider call, and entirely ours. ADR-T01 argued that a completeness gate makes a short window
safe (*"a short window costs a round trip and a long one is latency on every finished answer"*)
and then left the constant at 2 000 anyway.

Measurement makes the case stronger than ADR-T01 realised. STT costs ~500 ms fixed plus ~35 ms
per audio-second, and turn-taking's restart-before-upload means every fragment except the last is
transcribed while the candidate is still talking. So only the final fragment's STT is on the
critical path, and a shorter window makes that fragment short: 2 000 → 1 000 buys ~1 000 ms of
window plus ~250 ms of STT.

**Decision:** The constant moves here, not in `turn-taking`, and only after two conditions hold:
turn-taking T04 has shipped (without restart-before-upload the extra probes land on the critical
path instead of off it), and the gate's accuracy on real, noisy speech is known.

**Why not just change it with the gate:** because the gate's accuracy is unmeasured, and the
failure mode of a short window plus an inaccurate gate is the exact complaint this whole line of
work started from — being cut off mid-thought. Shipping the window shorter on faith would
reintroduce it faster.

**Consequences:** L03 is blocked on T04 and on data, and says so. Extra probes cost one nano call
each and no extra STT money — ElevenLabs bills per audio-minute and the total audio is unchanged.

---

## ADR-L05 — 2026-08-11 — Streaming is a separate ledger, and streaming STT is a different product

**Context:** The suggestion that opened this ledger was to stream. Measured, streaming splits into
three projects with very different prices, and one of them is not an optimisation at all.

**Decision:** All of it stays out of this ledger and lives in #266.

- **Pipelined conductor→TTS** (~1 700 ms) is the real streaming win — stream tokens, cut at the
  first complete sentence, stream that sentence's audio. Worth a ledger when latency is worth a
  ledger.
- **Streaming the LLM alone** buys ~0.6 s, because the conductor emits **34 output tokens** and
  most of its 1 180 ms is time-to-first-token, not generation. This is the finding that makes
  "stream it" the wrong first instinct, and it is the reason the pipelining and the streaming are
  named separately.
- **Streaming STT** (~1 650 ms) reverses ADR-S01, puts a provider websocket back into an
  architecture that deliberately removed one, and **obsoletes `turn-taking` entirely** — a live
  partial transcript carries its own end-of-utterance signal, so the completeness gate, the held
  partial, the 13 s clock and the recovery notice all stop existing.

**Consequences:** If streaming STT is ever wanted, `turn-taking` should be **paused, not built and
then discarded**, and that instruction is in its STATE.md. Declined by the owner 2026-08-10 on the
grounds that turn-taking fixes a complaint people actually voiced and streaming STT fixes a
number.
