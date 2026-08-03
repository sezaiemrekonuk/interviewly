# I07 — State machine transition table + pause/resume + SSE state events
REPO: (this repo) · Depends: I06, I02 · Status: done
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
- [x] **1. Complete `machine.ts`** — the full `TRANSITIONS` map (listed edges above),
  `canTransition`, `applyTransition` emitting `INTERVIEW_STATE_CHANGED`.
- [x] **2. Route all state writes** through `applyTransition` (answers handover, generation
  pause). Grep-confirm no direct `state:` write remains.
- [x] **3. Write `resume.ts`** — `paused`-only → prior round; attach to the router (CSRF).
- [x] **4. Write `sse.ts`** — owner-scoped SSE over the Redis channel; `applyTransition`
  publishes; expose the `enqueueReport` emission hook (`REPORT_JOB_ENQUEUED`) for `→
  evaluating`.
- [x] **5. Wire the `hr_round → paused` edge** from I04's generation failure path.
- [x] **6. Wire acceptance step-defs** for `interview_flow.feature` @AC-16 (each listed
  transition succeeds + emits the event; each unlisted transition is 409
  `INVALID_STATE_TRANSITION` with no state change).
- [x] **7. Run the `## Verification` command.**

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

**What exists now**

- `machine.ts` — table complete: `created→profiling`, `profiling→hr_round`,
  `hr_round→{tech_round,evaluating,paused}`, `tech_round→evaluating`, `paused→hr_round`,
  `evaluating→{completed,failed}`. `applyTransition` writes the column **conditionally on the
  state it read** (`updateMany where { id, state: from }`, `count === 0` → 409, ADR-I32),
  **mutates `interview.state` in place** (a request that transitions twice — `POST /profile`
  then a failed generation — would otherwise re-read a stale `from`), logs, publishes
  best-effort, and calls `enqueueReport` on `→ evaluating`.
- **A caller that transitions on a failure path must not let a 409 replace its own error.**
  `generation.ts` catches around the pause and logs `INTERVIEW_PAUSE_FAILED`.
- `sse.ts` — `EVENT_CHANNEL_PREFIX` (`interview:events:`), `eventChannel(id)`,
  `publishStateChanged`, `enqueueReport` (logs `REPORT_JOB_ENQUEUED`; R01 replaces the body
  with the BullMQ job), `streamInterviewEvents`.
- `resume.ts` — `paused`-only guard, then `paused → hr_round`.
- **`applyTransition` is now the sole writer of `interviews.state`.** `grep "state: '"` over
  `backend/modules backend/src` returns one hit: `setup.ts`'s `create` at `'created'`.

**Deviations from the task file**

- **ADR-I29: the SSE route is `GET /interviews/:id/events`, not `/events/interviews/:id`.**
  On the existing router it inherits `requireAuth`, `router.param('id', resolveInterview)`
  and the GET exemption in `requirePublicOrigin`; a root-mounted path would duplicate all
  three. REFERENCE.md line 108 patched.
- **ADR-I30: one `redis.duplicate()` per open stream, not the shared client.** ioredis puts a
  connection into subscriber mode exclusively. Sharing one subscriber needs a channel →
  response map plus refcounted unsubscribe — deferred, `ponytail:` comment in `sse.ts`.
- **ADR-I31: `POST /interviews` inserts at `state: 'created'` and transitions.** One extra
  UPDATE per interview; the alternative is the only state change in the system that emits no
  `INTERVIEW_STATE_CHANGED`, and @AC-16 lists the edge.
- No `tech_round → paused` / `paused → tech_round`: ADR-I22 generates both batches during the
  HR round, so no trigger exists. Add the edges with the source that needs them.

**For I08** — the budget ceiling lands in `answers.ts` where the `>>> I08` marker is, and its
exhaustion path is `applyTransition(interview, 'evaluating', …)`; both source states already
list that target. `@AC-11` still carries `@unwired` — **delete it before your first run**
(ADR-I26) or the scoped command matches 0 scenarios and exits 0.

**For I09** — `enqueueReport(interviewId, ctx)` in `sse.ts` is the emission point on
`→ evaluating`. Replace its body; do not add a second call site.

**Verification** — `npm run test:acceptance -- --tags "@interview-flow and @AC-16"` →
`1 scenario (1 passed), 8 steps (8 passed)`. Full rings: default 32/32, auth 11/11.
`lint`, `typecheck`, `test` (95 unit) green. Local run needs `DATABASE_URL` /`REDIS_URL` on
the published host ports (`localhost:5432`, `localhost:6380`), not `.env`'s compose names.
