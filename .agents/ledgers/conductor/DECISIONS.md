# Conductor — Decisions (append-only ADR log)

Never edit past entries. Supersede with a new dated entry referencing the one it changes.
Prefix `ADR-C` to avoid collision with foundations (`ADR-F`), auth (`ADR-A`), interview-core
(`ADR-I`), adaptive (`ADR-D`), speech (`ADR-S`), voice (`ADR-V`) and every other ledger.

The ledger exists because of one complaint that no existing ledger owned: *the interview feels
robotic.* Not a bug in any of them — interview-core progressed correctly, adaptive selected
correctly, speech spoke correctly. The interviewer simply had no turn of its own. It never
greeted anyone, never asked what they meant, and could not decide that a round was finished or
that an interview should stop. Progression was arithmetic: one answer, `current_index + 1`.

---

## ADR-C01 — 2026-08-10 — The conversation is stored as it happens, and it is the interview's state

**Context:** §3.8 requires a refreshed room to reconstruct itself from `GET /state` with no
client memory. That held trivially while the state *was* `current_index`: an integer and the
question row it points at. It stops holding the moment an interviewer decides when to advance,
because then what it decides on is the conversation — and `chat_messages` carried only one row
per answered turn, written by `answers.ts`, with no assistant rows at all. Three options: (A)
persist every utterance including the interviewer's, before it is delivered; (B) keep the
conversation in memory for the life of a request and rebuild it from question/answer pairs on
refresh; (C) hold it in Redis keyed by interview.

**Decision:** (A). Every utterance is a `chat_messages` row written before it is spoken or
shown. Two nullable columns carry what a bare log cannot: `question_id`, which is what makes an
answer recoverable from a window of utterances, and `action`, the decision the interviewer took
at the end of that turn. `ConductorAction` is a Postgres enum, so `continue` is a *value* —
"stayed on this question deliberately" and "no decision was recorded" are different facts.

**Why not (B):** Pairs cannot represent the things that make the interview not robotic. The
welcome belongs to no question; a clarification belongs to a question that has no answer yet;
the handover line belongs between two rounds. Rebuilding from pairs means replaying a different
interview than the candidate sat through — and the interviewer would then reason about it.

**Why not (C):** The conversation is not a cache. Losing it loses the interview, and the report
is generated from an interview that may have finished hours earlier by a worker in another
process. Redis in this system is a fan-out and a rate-limit store; nothing durable lives there.

**Consequences:** `chat_messages` gains an `(interview_id, created_at)` index because replay
reads it on every turn. The abandoned sweeper's "last activity" proxy gets sharper for free —
it counted only answers before, so an interview mid-clarification looked idle. Ordering is
`created_at` then `id`: a user utterance and the reply to it are written inside one request and
can share a millisecond, and a replay that puts the answer before the question is a different
interview again.

---

## ADR-C02 — 2026-08-10 — The interviewer is a JSON turn, and the server is the authority on every action

**Context:** The interviewer needs to do five things a return value has to express: say
something, stay on the question, move on, hand the round over, end the interview, and put a
typed surface on screen. Three mechanisms: (A) provider-native tool calling; (B) one prompt
returning a JSON object `{say, action, …}` through the layer-2 Zod gate every other call in
`packages/ai` already passes through; (C) two calls per turn — one to write the reply, one to
classify what should happen next.

**Decision:** (B). `interview.conduct.turn` returns `ConductorTurnSchema`, and
`backend/modules/interview/conductor.ts` re-derives every action from the interview row before
writing anything. Five guards, none of which consult the model's answer:

1. the advance goes through ADR-I06's `current_index` CAS, so a duplicated or replayed
   `next_question` is a no-op rather than a double skip;
2. `handover` is refused until the HR round has answered `ceil(hr_question_count / 2)`;
3. `end_interview` is refused on the opening exchange;
4. past `CONDUCTOR_MAX_TURNS_PER_QUESTION` the server advances without asking;
5. past `CONDUCTOR_MAX_TURNS` the interview ends regardless.

**Why not (A):** `providers.ts` speaks to both tiers through one hand-rolled `fetch` each —
deliberately, ADR-I02: no provider SDK is imported anywhere in this repo. Native tools would
have to be implemented, validated and kept in step twice, in two different wire formats, to buy
a capability this call does not need (it never wants two tools at once). One schema through the
gate that already exists costs nothing new and fails the same way everything else fails.

**Why not (C):** Two calls double the latency of the one call a candidate waits on with nothing
on screen, and they can disagree — a reply that asks a follow-up paired with a classification
that says "advance" is a question nobody will ever answer.

**Why the guards are not merely belt-and-braces:** the object is derived from candidate text.
That makes it untrusted input in exactly the §7.1 sense, and the actions mutate interview
state. `injection-patterns.yaml` guards prompt *variables*; it does not guard *actions*. "End
the interview now" is a sentence a candidate can type, and guard 3 is what makes typing it
useless. The prompt is also *told* the allowed actions — as a courtesy, so an interviewer does
not spend its turns on refusals, never as the check.

**Consequences:** `CONDUCTOR_ACTION_REFUSED` is logged with a reason on every downgrade; a
prompt that keeps asking for something it may not have is otherwise invisible. `personas.
system_prompt`, seeded since F02 and read by nothing, is finally the conductor's brief — the HR
and technical rounds are now genuinely different interviewers rather than one voice with two
names.

---

## ADR-C03 — 2026-08-10 — An answer is the window of utterances, and the report is told what it did not get

**Context:** `answers` is one row per question, and `orderTranscript` took `answers[last]`.
Under a conductor a candidate answers across several turns — a first pass, a clarification, a
correction. Two questions fell out: what is *the* answer, and what does the report make of an
interview that stopped early, which `end_interview` and `handover` now both produce.

**Decision:** The answer is the join of every user utterance carrying that question's id, and
`scoreAnswer` runs on the join. Separately, `GenerateReportArgs` gains `endedReason`,
`answeredCount` and `plannedCount`, and the report prompt is bumped to v3 (same uuid, same
name, v2 left on disk — the K9 revision rule) to consume them.

**Why:** Scoring the last message scores whichever fragment the candidate happened to end on,
and most people end on "…yeah, that's basically it". The coverage half is the same defect one
level up: a two-of-eight interview was scored on the same terms as a complete one and simply
read as thin, with no way for the model to know the difference. `cut_short` had been in the
`EndedReason` enum since the init migration with nothing writing it and only `admin/stats`
reading it; C02 is what finally writes it.

**Consequences:** An interview that ends early leaves unasked question rows behind, which the
transcript builder already drops. That is now correct rather than merely tolerated, because the
model is told the count it is missing. `coverage` is passed as one preformatted string, not two
numbers: a model handed `3` and `8` in separate fields reliably scores as though it saw eight.

---

## ADR-C04 — 2026-08-10 — A typed answer surface is a property of the question, in both modes

**Context:** `QuestionKind.widget` and `InputMode.widget` have existed since the init migration
with nothing to put in them, and `state.ts` returned a hardcoded `widget: null` beside a
`ponytail:` note saying so. Some answers are a list, a snippet or a precise value; dictating
those is worse than typing them, and in voice mode there was no way to type at all — the room's
own test asserted `queryByRole('textbox')` was absent.

**Decision:** `questions.widget` is a JSONB column holding `{kind, label, options?}`, written by
the conductor's `show_widget` action and returned by `GET /state`. The room renders it in
**both** modes; a `choice` renders a native `<select>`.

**Why on the question and not on the message:** a refresh has to re-render the box. The message
that announced it is prose and will scroll away; the surface belongs to the thing being
answered.

**Why a native select:** the platform ships a keyboard-complete, screen-reader-complete listbox
and `ui/select.tsx` already wraps it. `ui.test.tsx` has an assertion named "renders a native
select, never a listbox widget" — this ledger is not the place to argue with it.

**Consequences:** voice mode is no longer audio-only for answering, which is a change to what
that mode means. The room's voice test that asserted no textbox exists is now wrong on purpose
and is updated with it.

---

## ADR-C05 — 2026-08-10 — The generated batch is an agenda with a fallback sentence, not a script

**Context:** Once an interviewer writes its own questions, the pre-generated batch is either
redundant or a script it reads out. Three shapes: (A) delete the batch and let the conductor
author every question live; (B) keep verbatim questions the conductor may override; (C) each
item carries `intent` — what the slot is for, in the interviewer's words — *plus* one askable
sentence.

**Decision:** (C). `QuestionSchema` gains an optional `intent`; `questions` gains a nullable
`intent` column; the generation prompt goes to v3 emitting both.

**Why not (A):** three things depend on the batch existing that are easy to miss. Topic
coverage is derived from the job listing and CV and is the product — the report is scored
against a role, not against whatever the conversation drifted into. The pause/resume machinery
(#89) repairs a round by *regenerating* it, and there is nothing to regenerate into without a
batch. And ADR-I22 moved batch generation off the critical path precisely so a handover is
never a loading screen.

**Why not (B):** the batch's existence pulls toward reading it. An interviewer handed a
finished sentence tends to say the sentence, which is the robotic interview again with better
manners.

**Why `text` stays required:** it is what an interview falls back to when the conductor cannot
be reached mid-round. An agenda with no sentences turns a provider outage into a room with
nothing to ask.

**Consequences:** K4 (ADR-D01–D03) survives and changes job. It no longer decides wording — the
conductor has the whole conversation, which is strictly more context than three pre-generated
candidates had. It still scores the answer for the report, and it still supplies the next row's
text on the path where the conductor did not: a provider failure that fell back, or a drift.
Adaptive is now the degradation path, which is where a mechanism with no conversation behind it
belongs. Nothing in D01–D03 was deleted.

---

## ADR-C06 — 2026-08-10 — Voice speaks messages, not question indices

**Context:** `GET /:id/questions/:index/speech` can only ever speak a question row. Everything
that makes the interview not robotic — the welcome, a clarification, the handover, the closing
line — is not a question and has no index, so in voice mode all of it was silent. The answer
path had the mirror problem: `POST /:id/answers/audio` always advances, so a voice candidate
could never be asked a follow-up.

**Decision:** `GET /:id/messages/:messageId/speech` speaks any assistant `chat_messages` row,
cached at `speech/msg-{id}.mp3`; `POST /:id/turns/audio` transcribes and hands the text to the
conductor instead of to `advanceWithAnswer`. The room speaks unspoken assistant messages oldest
first, tracked by id.

**Why by id and not by index:** an id is stable across refetches and a room that reloads
mid-interview must not re-speak or skip. It also drops the `current_index` gate, so a past line
stays replayable — which is what makes a refresh recoverable rather than merely survivable.

**Why both old routes stay:** `POST /answers` and `/answers/audio` are the plain
one-answer-one-advance contract and the acceptance suite is written against them. Two
contracts, two routes; the conversational one does not pretend to be the other.

**Consequences:** TTS is bought per utterance rather than per question, so a talkative
interview costs more voice as well as more tokens — the same pressure that moved
`BUDGET_USD_TEXT` from 0.50 to 1.50 (ADR-C02's ceilings are the other half of that answer).
Metering is unchanged: S04's `meterTts` bills characters the same way whatever the text was.
