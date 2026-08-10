---
task: C06
author: Sezai
sessions: [2026-08-10]
model: claude-opus-5
model_recommended: claude-opus-5
iterations: 1
tools: [claude-code, subagents]
---

## Session 1 — 2026-08-10

### What I asked for / what came back
- `GET /interviews/:id/messages/:messageId/speech` — speaks any assistant `chat_messages` row,
  cached at `speech/msg-{id}.mp3`, same guard ladder / budget lock / metering / downgrade
  mapping as the question route. Not gated on `current_index`.
- `POST /interviews/:id/turns/audio` — transcribes and hands the text to `conductTurn` instead
  of `advanceWithAnswer`. No `questionId` in the body.
- `use-voice-session.ts` speaks unspoken assistant messages oldest-first and opens the mic after
  the last one.
- `GET /:id/questions/:index/speech` and `POST /:id/answers/audio` both stay, unchanged.

### Methodology trace
- Delegated the backend half and the frontend data layer to two agents in parallel with the wire
  contract written out in both briefs, because the two halves only meet at four strings (two
  routes, one request body, one response body). They agreed on all four without talking.
- The backend agent chose to lift the shared parts of the two TTS routes into helpers rather
  than copy `serveQuestionSpeech`, and gave the reason I would have given: the double-checked
  cache read inside the budget lock and "serve bytes that were already billed even when the
  cache write fails" are exactly the code that gets fixed in one copy and not the other, and the
  failure mode is a double charge with nothing going red.

### Friction — three the agents surfaced that I would have missed
- **A handover writes two assistant lines in one turn** (the handover line, then the new
  interviewer's greeting). Opening the mic after the first would have talked over the question.
  The loop speaks the whole pending run sequentially and only then records.
- **A refresh mid-interview would replay the interview from the greeting.** Fixed by seeding the
  spoken set on first run with everything up to and including the last `user` row — the trailing
  assistant run survives, which is exactly the prompt a reload does have to replay.
- **Marking an id spoken before its fetch.** Required, not sloppy: the mic meter re-renders the
  room ~60x/s, and `messages` is an effect dependency, so a derived array in the page would tear
  the effect down mid-fetch and nothing would ever play. The page passes react-query's array
  through untouched, with a comment saying why.

### What I rejected and rewrote by hand
- Rejected keying the spoken set on index. An id is stable across refetches; an index is not,
  and the failure mode is re-speaking or silently skipping a line.
- Rejected letting a missing question lookup throw when resolving a voice id. It falls back to
  the round arithmetic — a mute room is a worse failure than a slightly wrong voice.

### Verification (verbatim)
- `npm test -- --project node speech` → `Test Files 4 passed (4)`, `Tests 48 passed (48)` — 36
  pre-existing assertions unchanged, 12 added.
- `npm run -w frontend test -- src/lib` → `10 files, 70 tests passed` (hook suite rewritten for
  the message-driven loop, 21 tests).
- `npm run typecheck` clean · `npm run lint` clean.

### Follow-up left for the ledger (non-blocking)
- TTS is now bought per utterance rather than per question, so a talkative interview costs more
  voice as well as more tokens. `BUDGET_USD_TEXT` moved 0.50 → 1.50 and C02's two turn ceilings
  are the other half of that answer; whether 1.50 is right is a question for real usage.
