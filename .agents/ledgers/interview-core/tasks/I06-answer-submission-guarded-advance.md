# I06 — Answer submission, guarded advance, duration, round handover, resume-read
REPO: (this repo) · Depends: I04 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — this is the K2 progression invariant. The guarded optimistic advance, the server-clock duration, and the HR→tech handover are correctness-critical; a race here lets an answer target a non-current question.

## Goal
Owner's ask:

> "`POST /interviews/:id/answers`: the guarded advance that rejects a non-current question
> with `QUESTION_NOT_CURRENT`, the server-clock `duration_ms`, the answer + chat_message
> write, the HR→tech round handover, and `GET /state` resuming at the next unanswered
> question after a refresh. Scenarios AC-8, AC-9, AC-10 in `interview_flow.feature` green."
> — interview-core decomposition (§3.8, K2, ADR-I06)

This task adds the answer handler, the guarded `current_index` advance, the transcript
write, and the round-handover step. It creates the transition-guard helper `machine.ts` in
skeletal form (I07 fills the full table). It does **not** enforce the budget ceiling (I08
wraps the AI-call transaction) or count language switches (I10).

## Security boundaries
- **`current_index` advances only via the guarded `updateMany … WHERE id = $id AND
  current_index = $expected`** (ADR-I06). `count === 0` → 409 `QUESTION_NOT_CURRENT`, no
  state change. The body's `questionId` must resolve to the row at `current_index`; a
  mismatch is the same rejection.
- **`duration_ms` is computed on the server clock**, `answered_at − deliveredAt`, ignoring
  any client-supplied duration (`interview_flow.feature` @AC-10 sends `duration_ms 999` and
  asserts the stored value is `12000`). Never trust a client clock.
- **A non-owned `:id` is 404 `INTERVIEW_NOT_FOUND`** — via the I03 ownership resolver.

## Non-negotiables
- **Guarded advance:** at question k, an answer for question k+1 → 409
  `QUESTION_NOT_CURRENT`, `current_index` stays k; an answer for question k → 200,
  `current_index` becomes k+1 (@AC-8).
- **Transcript write:** each answered turn writes an `answers` row (`transcript`,
  `input_mode`, `started_at`, `answered_at`, `duration_ms`) and a `chat_messages` row
  (`role`, `content`, `trace_id`). Log `ANSWER_RECORDED`.
- **Round handover:** the last HR answer transitions `hr_round → tech_round` (the tech batch
  already exists, generated during HR by I04); the last technical answer transitions
  `tech_round → evaluating`. `current_index` is global 1..N; the tech round's `order_index`
  is per-round, `current_index = hr_question_count + order_index` in the tech round.
- **Resume read:** `GET /state` after a refresh (new client connection) returns
  `currentIndex` at the next unanswered question and a transcript cursor covering the
  answered count, with no client memory (@AC-9).

## Context (anchors)
- `backend/modules/interview/answers.ts` — **create.** `POST /interviews/:id/answers`: Zod
  body (`{ questionId, transcript, inputMode }`), resolve the row at `current_index`,
  guard-advance via `updateMany`, `count === 0` → `QUESTION_NOT_CURRENT`, else write the
  `answers` + `chat_messages` rows, compute `duration_ms` on the server clock, run the
  handover, 200 `{ state, nextIndex }`. Leave the budget-check slot (I08) marked *before*
  any AI call the handover incurs.
- `backend/modules/interview/machine.ts` — **create (skeletal).** `canTransition(from, to)`
  + `applyTransition(interview, to)` covering the edges this task uses: `hr_round →
  tech_round`, `tech_round → evaluating`. I07 fills the full table and pause/resume; keep the
  shape extensible (a `TRANSITIONS` map).
- `backend/modules/interview/state.ts` — I03. Confirm `GET /state` derives `currentIndex`
  and the transcript cursor from the DB only (resume-safe). Extend if the transcript cursor
  field is not yet present.
- `backend/modules/interview/router.ts` — I03/I04. Attach `/answers` at the marked slot,
  behind ownership + CSRF.
- `backend/src/lib/db.ts` — F02 `prisma`. The guarded advance is a single `updateMany`;
  `deliveredAt` comes from the current question's `asked_at` (set when the question is
  delivered — set it in `state.ts`/`answers.ts` when a question first becomes current).
- `backend/src/lib/error-codes.ts` — F01. `QUESTION_NOT_CURRENT`, `INVALID_STATE_TRANSITION`.

  **The trap:** `duration_ms`'s `deliveredAt` must be a server-recorded timestamp
  (`questions.asked_at`), set when the question first becomes the current one — not the
  answer's `started_at` from the client. @AC-10 fixes the clock at `10:00:00Z` and the
  delivery at `09:59:48Z`, expecting exactly `12000` ms; if you use a client timestamp you
  fail. Set `asked_at` server-side when `current_index` reaches the question.

## Steps
- [ ] **1. Write `machine.ts`** (skeletal) — `TRANSITIONS` map + `canTransition` +
  `applyTransition` for the two edges this task uses.
- [ ] **2. Write `answers.ts`** — Zod body, resolve current row, guarded `updateMany`,
  `QUESTION_NOT_CURRENT` on `count 0`, write answer + chat_message, server-clock
  `duration_ms`, handover, 200. Mark the I08 budget-check slot before the handover's AI call.
- [ ] **3. Set `asked_at` server-side** when a question becomes current (in `state.ts` on
  read and/or on advance in `answers.ts`).
- [ ] **4. Confirm/extend `state.ts`** resume read — `currentIndex` + transcript cursor from
  the DB, refresh-safe.
- [ ] **5. Attach `/answers`** into the router behind ownership + CSRF.
- [ ] **6. Wire acceptance step-defs** for `interview_flow.feature` @AC-8 (non-current →
  409, index unchanged; current → 200, index+1), @AC-9 (resume at next unanswered, cursor
  covers answered count, stable across a new connection), @AC-10 (server-clock
  `duration_ms 12000`, no audio session required).
- [ ] **7. Run the `## Verification` command.**

## Definition of done
- An answer for a non-current question is 409 `QUESTION_NOT_CURRENT` with no state change; an
  answer for the current question advances `current_index` by one.
- `duration_ms` is the server-clock delta `answered_at − asked_at`, ignoring the client
  value.
- The last HR answer moves the interview to `tech_round`; `GET /state` after a refresh
  resumes at the next unanswered question with a transcript cursor covering the answered
  count.

## Verification
```bash
npm run test:acceptance -- --tags "@interview-flow and (@AC-8 or @AC-9 or @AC-10)"
```

## Notes
_(fill in when the task is done)_
