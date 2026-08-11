# T03 — Turn paths: gate, join, hold, and the silence turn
REPO: (this repo) · Depends: T01, T02, C01, C02 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — the invariant lives here. Silence rows must be counted by **both**
ceilings or a silent candidate loops with the interviewer nudging forever, and every test passes
while it does. The `resolveMessages` filter is a documented trap: widening it wrong deletes the
entire candidate side of the room. And this is the task where a text field could quietly reappear
on the voice route.

## Goal
Wire T01's gate and T02's buffer into the two turn routes, and give the room a way to say
"thirteen seconds have passed" that the **server** interprets.

## Non-negotiables
- **The voice route never accepts candidate text.** `parseTurnAudio` currently allows **no**
  fields (`stt.ts:68`). It gains exactly one — `force`, validated as the literal `'1'` — and the
  comment there must say why no text field is allowed. ADR-T02 is the reason: a `pending` field
  on the wire lets a candidate post words they never spoke into the utterance the conductor
  answers, the transcript records and the report scores, while paying for a fraction of a second
  of audio.
- **The turn always ends.** `force`, `probes >= MAX_PROBES_PER_TURN`, or
  `length > MAX_PENDING_CHARS` all skip the gate and forward. Any gate failure forwards. The only
  thing a `finished: false` verdict may do is delay.
- **Silence counts toward both ceilings.** `utterances` (`conductor.ts:196`) and
  `turnsOnQuestion` (`:208-210`) both count `role === 'user'` today. Both must also count silence
  rows, so the existing forced-`drift` clamp at `:337` advances the question after
  `CONDUCTOR_MAX_TURNS_PER_QUESTION` combined turns. **No new ceiling, no new config.**
- **`answerWindow` is not touched.** It filters `role === 'user'` (`conductor.ts:693`), so
  silence never reaches scoring. Leave it exactly as it is.
- **The `action: null` branch survives.** `resolveMessages`'s filter (`state.ts:187-190`) is
  `OR: [{ action: null }, { action: { not: 'refused' } }]` and the comment above it explains
  that every candidate turn has `action = null`, and that a bare `not`/`NOT` excludes NULL rows
  in SQL. Widening to a `notIn` must keep that branch, or the whole candidate side of the room
  vanishes. Write the test that catches it.
- **A state read never consumes.** `GET /state` uses a plain `GET`, never `takePendingTurn`. Two
  refreshes must show the same text.
- **No migration.** `chat_messages.action` is free text and already carries `continue`, `drift`
  and `refused`.
- **The gate is billed inside `withBudget`** like every other provider call (I08, K13).

## Context (anchors)
- `backend/modules/speech/stt.ts:51-68` — `audioParser`, `parseAudio`, `parseTurnAudio`.
- `backend/modules/speech/stt.ts:161-194` `transcribeRecording`, `:241-261` `submitTurnAudio`.
- `backend/modules/interview/conductor.ts:48-51` `turnInputSchema`; `:141` `runTurn`; `:166-192`
  the candidate-message block; `:196-211` both ceilings; `:337` the drift clamp; `:759`
  `noteRefusal` — the model to copy for a `role: 'system'` row the room hides.
- `backend/modules/interview/turns.ts:17` `submitTurn`.
- `backend/modules/interview/state.ts:25` `currentQuestionRow`, `:175` `resolveMessages`,
  `:187-190` the filter, `:253` `getInterviewState`.
- `backend/modules/speech/pending-turn.ts` (T02) — the three functions and the two caps.

## Steps
- [x] **1. Test red** — the six behaviours below, all red first: unfinished holds and conducts
  nothing; a second fragment conducts one joined row; a text field is refused; a gate failure
  forwards; a stale `questionId` is dropped; silence writes a system row the room does not show.
- [x] **2. `submitTurnAudio`** — `takePendingTurn` first (drop on `questionId` mismatch), then
  `transcribeRecording`, then join `[held?.text, transcript].filter(Boolean).join(' ')`.
  Empty join ⇒ `SPEECH_AUDIO_INVALID` as today. Empty transcript with a held partial ⇒ re-hold
  unchanged and return it; no gate call, no charge for a verdict on nothing.
- [x] **3. The gate call** — inside `withBudget`, fail-open on everything, log
  `CONDUCTOR_TURN_GATE_FAILED` on that branch. Skip it entirely for `force` and for either cap.
- [x] **4. Hold or conduct** — `finished: false` ⇒ `holdPendingTurn` with `probes + 1`, return
  `200 { state, currentIndex, pendingTurn: full }` with **no** conductor call and **no**
  chat row; log `CONDUCTOR_TURN_HELD` with length and probe count, never text. `finished: true` ⇒
  `conductTurn` as today plus `pendingTurn: null`.
- [x] **5. `force`** — `parseTurnAudio` gains one field; validate the literal `'1'`; update the
  comment at `stt.ts:67-68` to state that no text field is allowed and why.
- [x] **6. `kind: 'silence'`** — on `turnInputSchema`, defaulting to `'utterance'`, `text`
  optional when silence. `submitTurn` takes the buffer first: a held partial for the current
  question turns a silence request into an ordinary utterance turn carrying that text.
- [x] **7. The silence row** — in `runTurn`, branch the `if (input)` block: a silence turn
  persists `role: 'system'`, `action: 'silence'`, `question_id`, content
  `[The candidate has said nothing for 13 seconds.]`, pushes the same row onto `history`, and
  **skips** the injection scan and `trackLanguage` — there is no candidate text to scan or detect
  a language from. Log `CONDUCTOR_SILENCE_TURN`.
- [x] **8. Both ceilings** — widen the two counters to include silence rows. Test that repeated
  silence on one question trips the drift clamp rather than looping.
- [x] **9. `resolveMessages`** — widen to `notIn: ['refused', 'silence']`, keeping the
  `action: null` branch. Test that candidate rows still appear.
- [x] **10. `pendingTurn` on `/state`** — plain `GET`, surfaced only when the stored `questionId`
  matches the current question row, `null` otherwise. Test that two consecutive reads return the
  same text.

## Definition of done
- turn-taking AC-1, AC-2, AC-3, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11 green.
- `grep -n "fields:" backend/modules/speech/stt.ts` shows the turn parser allowing one field, and
  the route rejects any text part.
- A silent candidate on one question reaches the forced advance; no path loops.
- `GET /state` shows candidate rows and hides silence rows in the same response.

## Verification
```bash
docker compose up -d db cache
npm test -- --project node speech interview/conductor interview/state
npm run test:acceptance
npm run lint && npm run typecheck
```
Expected: green. Acceptance runs from the host with port overrides and a **throwaway** Redis — a
shared cache leaks a held partial between scenarios and the queue scenarios lie.

## Notes

**Wire, for T04.** `POST /turns/audio` → `200 { state, currentIndex, pendingTurn: string | null }`
on **every** path; non-null means held, nothing conducted, no chat row. One optional multipart
field, `force`, literal `'1'`; any other field name and any other `force` value are
`VALIDATION_ERROR` before the provider (`turnFields`, `stt.ts`). `POST /turns` takes
`kind: 'utterance' | 'silence'`, default `'utterance'`; silence carries no text and the schema
**drops** any that arrives. `GET /state` gains `pendingTurn: string | null`.

**Deviation 1 — there IS a migration.** `chat_messages.action` is the `ConductorAction` enum, not
free text; the task and REFERENCE.md both said otherwise and REFERENCE.md is patched.
`20260811120000_conductor_silence` is one `ALTER TYPE … ADD VALUE 'silence'`, the same shape C07
used for `refused` (`20260810180000_conductor_integrity`) — no table rewritten, no column added.
`applyAction`'s switch gained a `case 'silence'` next to `refused` for exhaustiveness; neither is
an action a model can produce.

**Deviation 2 — empty join stays `SPEECH_TRANSCRIPTION_FAILED`.** Step 2 named
`SPEECH_AUDIO_INVALID` "as today", but today an empty transcript fails the `turnInputSchema`
parse and returns `SPEECH_TRANSCRIPTION_FAILED`. Kept, so the existing test and the acceptance
scenario still describe the route. `SPEECH_AUDIO_INVALID` still means a missing or zero-byte part.

**Deviation 3 — `submitTurn` takes the buffer on every turn**, not only a silence one, and
discards what it does not use (spec: "every turn submission takes the buffer first"). A fragment
the candidate stopped speaking and then typed past would otherwise be joined onto whatever they
said next.

**What T04 must know beyond the wire:**
- The 13 s clock is the room's; the server never times anything. A silence request with a held
  partial for the current question is silently conducted as that partial (@AC-10) — the room
  cannot tell the two cases apart and does not need to.
- `SPEECH_STT_TRANSCRIBED` now logs per fragment, not per conducted turn; three probes, three
  lines, three STT charges.
- `probes` and the joined length live in Redis only. The client sends neither and cannot reset
  either.

**Where the code is:** gate + join + hold in `stt.ts` `submitTurnAudio` (`utteranceFinished`,
`turnFields`, `turnState`); silence row + `countsAsTurn` in `conductor.ts`; `resolveSilence` in
`turns.ts`; `messagesWhere` + `pendingTurnFor` in `state.ts`; `peekPendingTurn` added to
`pending-turn.ts` (plain `GET`, never consumes).

## Verification output

`npm test` → 1035 passed (103 files), up from T02's 1015. `npm run test:integration` → 34 passed
(needs `db` and `cache`; a local Postgres owns 127.0.0.1:5432, so this ran with the container
republished on 55432 and Redis on 56379). `npm run test:acceptance` → 111 scenarios, 885 steps,
same as T01 — nothing regressed. `npm run lint`, `npm run -w frontend lint`, `npm run typecheck`
clean.

Both traps were mutation-checked rather than assumed. Dropping the `{ action: null }` branch from
`messagesWhere` reds `state.integration.test.ts` (@AC-8) and nothing else; narrowing `countsAsTurn`
back to `role === 'user'` reds both ceiling tests in `conductor.integration.test.ts`. Neither
mutation is visible to the unit ring, which is why both tests are integration ones.
