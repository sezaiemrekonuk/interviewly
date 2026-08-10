# Conductor — PLAN (Architecture)

Written once. Amend only via a new `DECISIONS.md` ADR-C entry referenced here.

## Goal

When this ships, an interview is a conversation. The interviewer introduces itself by name,
welcomes the candidate to the role being interviewed for, and asks its first question in its
own words. It reacts to what was actually said. It asks for specifics when an answer is vague,
and only moves on when it has what it needs. It can put a typed surface on screen when an
answer is better typed than spoken — in voice mode as well as text. It can decide a round has
covered enough and hand over to the other interviewer, and it can end an interview that should
not continue. All of that in both modes, and all of it recoverable on refresh.

What it must not become is an interviewer the candidate cannot escape or that a candidate can
talk into ending. The model proposes; the server decides.

## The invariant this initiative must not weaken

> The model is never the authority on interview state. Every action it asks for is re-derived
> from the interview row before anything is written, and `interviews.state` is still only ever
> written by `applyTransition` (K2). The advance still goes through ADR-I06's `current_index`
> compare-and-set.

This is the correctness heart of the ledger, and it is a security boundary as much as a
correctness one: the action is derived from candidate text, and it mutates interview state.
See ADR-C02 for the five guards and why the prompt's own "allowed actions" list is a courtesy
rather than a check.

## Topology

```
Browser
  │  POST /interviews/:id/turns          (text)      ─┐
  │  POST /interviews/:id/turns/audio    (voice, STT) ─┤→ conductor.ts
  │  GET  /interviews/:id/messages/:id/speech (TTS)   ─┘
  │  GET  /interviews/:id/state          → + messages[]
  ▼
conductor.ts
  ├─ chat_messages   ← every utterance, written before it is delivered   (ADR-C01)
  ├─ conductTurn()   → {say, action, question?, endReason?, widget?}     (ADR-C02)
  ├─ guards          → clampAction / drift ceiling / turn ceiling        (ADR-C02)
  ├─ recordAnswer()  → answers.ts, ADR-I06's CAS, shared with /answers   (ADR-C03)
  ├─ applyTransition → handover, end_interview                           (K2, unchanged)
  └─ promoteNextQuestion → K4, now the degradation path                  (ADR-C05)
```

Consumed, not re-implemented: the state machine (I07), budget enforcement (I08), round
generation (I04/I22), language detection (I10), the provider chain and cost audit (I02), the
speech provider seam (S01), and the adaptive selector (D01–D03).

## Tasks

| ID | What |
|---|---|
| C01 | Conversation persistence: `chat_messages.question_id` / `.action`, `questions.widget` / `.intent`, the replay index |
| C02 | The conductor: prompt lineage, `ConductorTurnSchema`, `conductTurn` on the seam, `conductor.ts`, `POST /turns`, the five guards |
| C03 | The answer window, and the report told its coverage and cut reason (report prompt v3) |
| C04 | Widget answer surfaces, rendered in both modes |
| C05 | Agenda-shaped batches: `intent` alongside the fallback sentence (generation prompt v3) |
| C06 | Voice: message-keyed TTS, `POST /turns/audio`, the room's speak-unspoken loop |

## What this ledger deliberately does not do

- **Streaming.** The conductor's reply arrives whole. A candidate waits one call with nothing
  on screen, which is why `TIMEOUT_MS.conductTurn` is 10 s rather than the 15 s every other
  interactive call gets. Token streaming is the next real latency win and is not here.
- **Native tool calling.** ADR-C02.
- **Deleting the adaptive ledger.** ADR-C05 — K4 changes job rather than dying.
- **Per-utterance input modes.** The answer window is stored under the interview's mode; a
  widget answer typed during a voice interview is recorded as voice. Noted in `conductor.ts`.
