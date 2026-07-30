# I08 — Budget enforcement (in-transaction ceiling, exhaustion path)
REPO: (this repo) · Depends: I06, I02 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — the $0.50 ceiling is the cost invariant (§7.3). Reading `spent_usd` outside the `llm_calls` transaction opens a double-charge race; losing the triggering answer on exhaustion is a data-loss defect. Both are subtle.

## Goal
Owner's ask:

> "Enforce the per-interview budget: read `spent_usd` inside the transaction that would
> record the next AI call; if `spent_usd >= budget_usd`, make no call, transition to
> `evaluating` with `ended_reason = budget_exhausted`, preserve the submitted answer, and
> return `BUDGET_EXCEEDED`. Scenario AC-11 in `interview_flow.feature` green."
> — interview-core decomposition (§7.3, ADR-I08, K13)

This task adds the in-transaction budget check that gates the next AI call an answer
incurs. It builds on I06's answer flow (the answer is already recorded) and I02's
`recordLlmCall` (which accepts a transaction handle). It does **not** change the generation
path itself — it wraps the call site.

## Security boundaries
- **The ceiling is read *inside* the `llm_calls` transaction** (ADR-I08). A concurrent call
  cannot slip a second charge between the read and the insert. Never gate on a `spent_usd`
  read taken outside the transaction.
- **The submitted answer is never lost.** The `answers` row is written by I06 *before* the
  budget gate; exhaustion preserves it (`interview_flow.feature` @AC-11 asserts the
  submitted answer is stored).
- **No AI call on exhaustion.** When `spent_usd >= budget_usd`, no provider call is made and
  no new `llm_calls` row for that submission is written (@AC-11 asserts no AI call is
  recorded).

## Non-negotiables
- **On exhaustion:** transition to `evaluating` (via `applyTransition`, I07),
  `ended_reason = 'budget_exhausted'`, log `BUDGET_EXHAUSTED`, generate the report from what
  exists (I09 owns the report path), and return 402 `BUDGET_EXCEEDED` to the triggering
  request.
- **`spent_usd` is incremented in the same transaction as the `llm_calls` insert** (the K13
  db contract). The budget check reads the current `spent_usd` in that transaction before
  the call; the increment happens on the call's return.
- **Stub mode never trips the budget.** `AI_ENABLED=false` records `cost_usd = 0` rows, so
  `spent_usd` stays 0 — a stub-mode interview runs to completion. Correct: it costs nothing.

## Context (anchors)
- `backend/modules/interview/budget.ts` — **create.** `withBudget(interviewId, tx, fn)`:
  inside the passed Prisma transaction, `SELECT spent_usd, budget_usd` for the interview
  (row-consistent read), if `spent_usd >= budget_usd` throw a typed `BudgetExceeded` (no
  call), else run `fn` (the AI call) and increment `spent_usd` by the recorded `cost_usd` in
  the same `tx`.
- `backend/modules/interview/answers.ts` — I06. At the marked budget-check slot (before the
  handover's AI call), wrap the AI call in `prisma.$transaction(tx => withBudget(...))`. On
  `BudgetExceeded`: `applyTransition(→ evaluating)`, set `ended_reason = 'budget_exhausted'`,
  return 402 `BUDGET_EXCEEDED`. The answer row is already persisted.
- `backend/modules/ai/index.ts` — I02. `recordLlmCall` accepts the `tx` handle so the insert
  and the `spent_usd` increment share one transaction.
- `backend/modules/interview/machine.ts` — I07. `hr_round → evaluating` and `tech_round →
  evaluating` are listed edges (budget exhaustion) — confirm they are in the table.
- `backend/modules/interview/report-run.ts` — I09. The exhaustion path enters `evaluating`;
  I09's report generation runs from there. This task only sets `ended_reason` and the
  transition.
- `backend/src/lib/error-codes.ts` — F01. `BUDGET_EXCEEDED`.

  **The trap:** the answer must be committed *before* the budget transaction so exhaustion
  cannot roll it back. I06 already writes the `answers`/`chat_messages` rows on submission;
  keep the budget transaction separate from (and after) the answer write, wrapping only the
  AI call + `spent_usd` increment. Do not fold the answer insert into the budget transaction.

## Steps
- [ ] **1. Write `budget.ts`** — `withBudget(interviewId, tx, fn)`: in-tx ceiling read, throw
  `BudgetExceeded` on exhaustion (no call), else run `fn` and increment `spent_usd` in `tx`.
- [ ] **2. Wrap the AI call** in `answers.ts` with `prisma.$transaction(tx =>
  withBudget(...))`, after the answer is already persisted.
- [ ] **3. Handle `BudgetExceeded`** — `applyTransition(→ evaluating)`, `ended_reason =
  'budget_exhausted'`, log `BUDGET_EXHAUSTED`, 402 `BUDGET_EXCEEDED`.
- [ ] **4. Confirm** the exhaustion `→ evaluating` edges are listed in `machine.ts` (I07).
- [ ] **5. Wire acceptance step-defs** for `interview_flow.feature` @AC-11 (spent equals
  budget inside the next AI transaction → 402 `BUDGET_EXCEEDED`, answer stored, no AI call
  recorded, state `evaluating`, endedReason `budget_exhausted`).
- [ ] **6. Run the `## Verification` command.**

## Definition of done
- When `spent_usd >= budget_usd` inside the AI transaction, no provider call is made, the
  submitted answer is preserved, the interview moves to `evaluating` with `ended_reason =
  'budget_exhausted'`, and the request returns 402 `BUDGET_EXCEEDED`.
- The ceiling read and the `spent_usd` increment share the `llm_calls` transaction.
- Stub-mode interviews (`cost_usd = 0`) never trip the budget.

## Verification
```bash
npm run test:acceptance -- --tags "@interview-flow and @AC-11"
```

## Notes
_(fill in when the task is done)_
