# I07 — State machine transition table + pause/resume + SSE state events
REPO: (this repo) · Depends: I06, I02 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — the full server-owned state machine is the interview-integrity invariant (K2). An illegal transition that slips through, or a pause that loses the answer, corrupts the interview; the transition table must reject every unlisted edge with no side effect.

## Goal
Owner's ask:

> "The complete transition table: every listed HTTP transition succeeds and emits
> `INTERVIEW_STATE_CHANGED` with from/to/interviewId; every unlisted transition is 409
> `INVALID_STATE_TRANSITION` and changes no state. Plus `hr_round → paused` on AI failure,
> `paused → hr_round` via `POST /resume`, and the SSE state-event stream. Scenario AC-16 in
> `interview_flow.feature` green."
> — interview-core decomposition (K2, §8.3, ADR-I07)

This task fills the skeletal `machine.ts` (I06) into the complete transition table, adds the
`POST /resume` handler, wires the `hr_round → paused` edge on an AI failure, and builds the
SSE fan-out that emits `INTERVIEW_STATE_CHANGED`. It does **not** own the budget-exhaustion
`→ evaluating` edge (I08) or the report path off `evaluating` (I09), but the table must list
those target states so those tasks attach cleanly.

## Security boundaries
- **Only listed transitions are accepted.** `applyTransition` consults the `TRANSITIONS`
  table; an unlisted `(from, to)` throws `INVALID_STATE_TRANSITION` (409) with **no** DB
  write. `interview_flow.feature` @AC-16 exercises unlisted edges (`hr_round`+`POST /profile`,
  `profiling`+`POST /answers`, `evaluating`+`POST /resume`) and asserts no state changes.
- **Pause preserves work.** `hr_round → paused` on an AI failure keeps every recorded answer
  and question; `POST /resume` returns to the round it left. No data is discarded on pause.
- **SSE stream is owner-scoped.** `GET /events/interviews/:id` runs behind the ownership
  resolver; a non-owner is 404 `INTERVIEW_NOT_FOUND`. The stream carries state events only —
  no transcript, no secret.

## Non-negotiables
- **The listed table** (`interview_flow.feature` @AC-16): `created → profiling`
  (POST /interviews), `profiling → hr_round` (POST /profile), `hr_round → tech_round` (last
  HR answer), `tech_round → evaluating` (last technical answer), `hr_round → paused` (AI
  timeout during generation), `paused → hr_round` (POST /resume). Also list (for I08/I09):
  `hr_round → evaluating` and `tech_round → evaluating` on budget exhaustion, `evaluating →
  completed`/`failed`.
- **Every accepted transition emits `INTERVIEW_STATE_CHANGED`** with `{ from, to,
  interviewId }` (log + SSE). Every rejected transition is 409 `INVALID_STATE_TRANSITION`
  with no emission and no state change.
- **`POST /resume` only from `paused` → the round it was in** (`hr_round` in the asserted
  case). From any other state → 409 `INVALID_STATE_TRANSITION`.
- **The `hr_round → paused` edge fires on `AI_PROVIDER_UNAVAILABLE`** from the chain during
  generation (the I04 failure edge routes here in its final form).

## Context (anchors)
- `backend/modules/interview/machine.ts` — I06 skeletal → **complete here.** The full
  `TRANSITIONS` map, `canTransition(from, to)`, `applyTransition(interview, to, ctx)` that
  writes the new state and emits `INTERVIEW_STATE_CHANGED` (log + SSE) in one place. Every
  state write in the module goes through `applyTransition`.
- `backend/modules/interview/resume.ts` — **create.** `POST /interviews/:id/resume`:
  `paused`-only guard, `applyTransition(paused → prior round)`, 200 `{ state }`.
- `backend/modules/interview/sse.ts` — **create.** `GET /events/interviews/:id` (behind
  ownership): an SSE response subscribed to a Redis pub/sub channel keyed by interview id;
  `applyTransition` publishes `INTERVIEW_STATE_CHANGED`. Also expose an `enqueueReport(id)`
  hook stub the report ledger consumes (log `REPORT_JOB_ENQUEUED`) — the real BullMQ job is
  the report ledger's; here it is the emission point on `→ evaluating`.
- `backend/modules/interview/generation.ts` — I04. Route its `AI_PROVIDER_UNAVAILABLE` path
  through `applyTransition(hr_round → paused)` now that the table exists.
- `backend/modules/interview/answers.ts` — I06. Confirm the handover edges go through
  `applyTransition`.
- `backend/modules/interview/router.ts` — attach `/resume` (non-`GET`, CSRF) and the SSE
  `GET /events/interviews/:id` (ownership, no CSRF).
- `backend/src/lib/env.ts` — F03. Reuse the single Redis client for pub/sub; do not open a
  second connection.
- `backend/src/lib/error-codes.ts` — F01. `INVALID_STATE_TRANSITION`.

  **The trap:** `applyTransition` must be the *only* writer of `interviews.state`. If any
  handler sets `state` directly, an unlisted transition can slip past the guard. Grep for
  `state:` writes after this task and confirm they all route through `applyTransition`.

## Steps
- [ ] **1. Complete `machine.ts`** — the full `TRANSITIONS` map (listed edges above),
  `canTransition`, `applyTransition` emitting `INTERVIEW_STATE_CHANGED`.
- [ ] **2. Route all state writes** through `applyTransition` (answers handover, generation
  pause). Grep-confirm no direct `state:` write remains.
- [ ] **3. Write `resume.ts`** — `paused`-only → prior round; attach to the router (CSRF).
- [ ] **4. Write `sse.ts`** — owner-scoped SSE over the Redis channel; `applyTransition`
  publishes; expose the `enqueueReport` emission hook (`REPORT_JOB_ENQUEUED`) for `→
  evaluating`.
- [ ] **5. Wire the `hr_round → paused` edge** from I04's generation failure path.
- [ ] **6. Wire acceptance step-defs** for `interview_flow.feature` @AC-16 (each listed
  transition succeeds + emits the event; each unlisted transition is 409
  `INVALID_STATE_TRANSITION` with no state change).
- [ ] **7. Run the `## Verification` command.**

## Definition of done
- Every listed transition succeeds and emits `INTERVIEW_STATE_CHANGED` with from/to/
  interviewId; every unlisted transition is 409 `INVALID_STATE_TRANSITION` with no state
  change.
- `POST /resume` returns a `paused` interview to its prior round; the `hr_round → paused`
  edge fires on an AI failure preserving all work.
- `applyTransition` is the sole writer of `interviews.state`; the SSE stream is owner-scoped
  and carries only state events.

## Verification
```bash
npm run test:acceptance -- --tags "@interview-flow and @AC-16"
```

## Notes
_(fill in when the task is done)_
