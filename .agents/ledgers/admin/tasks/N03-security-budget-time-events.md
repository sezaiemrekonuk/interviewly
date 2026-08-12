# N03 — Security, budget and time events land in `audit_logs` (US-29)
REPO: (this repo) · Depends: N01 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — changes a security-signal path and opens a seam across a package boundary. A sink that carried the matched value would put candidate text in a durable table (issue 063), and an audit write that can fail an interview turn is an availability regression. Both are security/availability, not a wrong number, so this runs at the expensive tier even though the diff is small.

## Goal
Owner's ask:

> "US-29 — an admin should see when the system defended itself: the prompt-injection
> suspicions, and the interviews that ran out of budget or out of time. Right now those are
> pino lines and one `ended_reason` value; there is no table the panel can read."
> — admin ledger backlog promotion (US-29; backend spec *Admin module* drill-down row,
> `.agents/specs/2026-07-29-backend.md:152`)

This task adds three `AuditAction` values and the two write paths that emit them. It writes
**no endpoint** — N04's drill-down is what reads these rows, which is why N04 depends on this
one. It does not change what the injection scan detects, does not change when an interview
ends, and adds no migration: `audit_logs.action` is a `String` by design (see `src/lib/audit.ts`).

## Non-negotiables
- **The sink is called alongside `logger.warn`, never instead of it.** The pino line is the
  operational signal and the audit row is the durable one; replacing one with the other loses
  a reader.
- **No matched value, ever.** The sink carries `{ interviewId, traceId, field, patternId }` —
  the bound variable's NAME and the pattern id. The text that matched is the candidate's own
  and must not reach `audit_logs` (issue 063, no PII).
- **`packages/ai` must not learn about a database.** It depends on neither `api` nor `worker`
  (K1). The durable half is injected by the caller (ADR-N06); a caller that passes nothing
  keeps the existing log-only behaviour.
- **The security write cannot delay or fail an interview turn.** The scan is explicitly
  non-blocking (§7.1.5) — a sink that could throw would hand the regex the veto the scan
  deliberately does not have.
- **The exhaustion write is best-effort and swallowed.** It is the only audit write in the
  codebase that is; every destructive path still writes its row inside the transaction.
- **No migration, no schema change.** ADR-F02 freeze holds.

## Context (anchors)
- `backend/src/lib/audit.ts` (:issue 86) — extend the `AuditAction` union with
  `security.prompt_injection_suspected`, `interview.budget_exhausted`,
  `interview.time_exhausted`. The column is a `String`, so a new action is a compile-time
  change, not a migration.
- `packages/ai/src/prompt-builder.ts` — export a `SecurityEventSink` type; `PromptBuilder`
  takes it as an optional fourth constructor arg; `createPromptBuilder({ logger,
  onSecurityEvent })` threads it. Called from `scanForInjection` at the existing
  `SECURITY_PROMPT_INJECTION_SUSPECTED` site.
- `packages/ai/src/providers.ts` — `ChainDeps.onSecurityEvent?`, optional. Threaded through
  `resolve-client.ts` and `live-client.ts`; the type is re-exported from `packages/ai/src/index.ts`.
- `backend/modules/ai/index.ts` — `recordSecurityEvent: SecurityEventSink` wires the sink to
  `recordAudit`, and `aiClient()` passes it. Detached (`void` + `.catch`). The actor is the
  interview's own account, looked up by `interviewId` — no operator is present, and the row
  still answers "whose data was this".
- `backend/modules/interview/machine.ts` (:I07) — `recordExhaustion(interview, ctx)`, called
  from `applyTransition` after the state row commits. Writes
  `interview.budget_exhausted` / `interview.time_exhausted` off `ctx.endedReason`, with
  metadata `{ spentUsd, budgetUsd, elapsedSeconds }`.
- `packages/ai/src/prompt-builder.test.ts` — the two new cases.

  **The trap:** the exhaustion row must be written **once, at the chokepoint**, not at the
  call sites. Six of them set those reasons — `budget.ts`, `conductor.ts`, `speech/stt.ts`
  and `speech/tts.ts` set `budget_exhausted`; `speech/stt.ts` and `speech/tts.ts` set
  `time_exhausted` — and every one arrives through `applyTransition`. Writing it out there is
  six copies and a seventh call site that forgets. And the write must be swallowed: an
  interview that ran out of budget HAS run out of budget, so refusing the transition because
  the note could not be filed leaves it burning the budget it just exceeded.

## Steps
- [x] **1. Extend `AuditAction`** with the three new values in `backend/src/lib/audit.ts`.
  Confirm no migration is implied (the column is `String`).
- [x] **2. Add `SecurityEventSink` to `packages/ai/src/prompt-builder.ts`** — exported type,
  optional fourth constructor arg, called at the existing warn site with
  `{ interviewId, traceId, field, patternId }`. Keep the `logger.warn`.
- [x] **3. Thread the sink** through `createPromptBuilder`, `ChainDeps` (`providers.ts`),
  `resolve-client.ts` and `live-client.ts`; export the type from `packages/ai/src/index.ts`.
- [x] **4. Wire `recordSecurityEvent` in `backend/modules/ai/index.ts`** — look the interview's
  `user_id` up, `recordAudit`, detached and `.catch`ed to `AUDIT_WRITE_FAILED`. Pass it from
  `aiClient()`.
- [x] **5. Add `recordExhaustion` to `backend/modules/interview/machine.ts`** — called from
  `applyTransition`, keyed off `ctx.endedReason`, best-effort, metadata `{ spentUsd, budgetUsd,
  elapsedSeconds }`.
- [x] **6. Tests** — in `packages/ai/src/prompt-builder.test.ts`: the sink fires with `field`
  and `patternId` and carries no matched text; building with no sink still works and stays
  log-only.
- [x] **7. Run the Verification commands.**

## Definition of done
- `AuditAction` carries `security.prompt_injection_suspected`, `interview.budget_exhausted`,
  `interview.time_exhausted`; no migration file was added.
- A suspected injection writes one `audit_logs` row **and** the existing pino line.
- The row's `metadata` is `{ field, patternId }` — the field name and the pattern id, never
  the matched text.
- `packages/ai` imports no Prisma and no `backend` module; a `PromptBuilder` built without a
  sink behaves exactly as before.
- Every `budget_exhausted` / `time_exhausted` transition writes one row, from
  `applyTransition` alone — `grep` finds no `recordAudit` in `budget.ts`, `conductor.ts`,
  `speech/stt.ts` or `speech/tts.ts` (`delete.ts`'s in-transaction row is N01's and stays).
- A failed audit write logs `AUDIT_WRITE_FAILED` and does not fail the turn or the transition.

## Verification
```bash
npm test -- --run packages/ai/src/prompt-builder.test.ts
npm run typecheck
```

Expected: `24 tests passed` in the one file (the two new cases included), typecheck silent.

Then confirm the write is at the chokepoint and the value never leaves the scan:
```bash
# machine.ts (the chokepoint) and delete.ts (N01's in-transaction row) only — nothing in
# budget.ts, conductor.ts or modules/speech.
grep -rln "recordAudit" backend/modules/interview backend/modules/speech
grep -rn "@prisma/client" packages/ai/src            # must print nothing (K1, ADR-N06)
```

## Notes

Done 2026-08-11. `packages/ai/src/prompt-builder.test.ts` 24 tests green; `npm run typecheck`
clean. Commit `6026c42`. **`npm run test:acceptance` was NOT run this session** — it needs the
compose stack up. No `@AC` scenario reaches this code either way: `@AC-17`/`@AC-18` assert
list and stats fields, none of which this task touches.

**What exists now**
- `AuditAction` +3 values, with the union's comment explaining why the actor is the subject's
  own account rather than an operator.
- `SecurityEventSink` exported from `@interviewly/ai`. Optional at every level —
  `PromptBuilder`'s fourth arg, `createPromptBuilder`'s option, `ChainDeps.onSecurityEvent`.
  `worker` and every test pass nothing and keep the old behaviour.
- `backend/modules/ai/index.ts` → `recordSecurityEvent`, wired in `aiClient()`.
- `backend/modules/interview/machine.ts` → `recordExhaustion`, called from `applyTransition`.

**Deviations from the plan**
- None structural. The exhaustion write sits **after** the `INTERVIEW_STATE_CHANGED` log and
  before the Redis fan-out, i.e. after the transition has committed — a row about a transition
  that then rolled back would be worse than no row.

**Why the two writes are not symmetric**
- Security: detached (`void` + `.catch`). The scan does not block a call, so awaiting a write
  would let Postgres latency delay the turn the suspicion was noticed during.
- Exhaustion: awaited but `try`/`catch`ed. The transition has already committed by then, so
  there is nothing to be atomic with, and there is no turn left to delay.
- Destructive paths (`interview.soft_deleted`) are unchanged: still inside the transaction,
  still able to fail the mutation. A delete with no record is the failure worth refusing.

**For N04**
The drill-down's `events` array is `audit_logs` where `subject_type = 'interview'` and
`subject_id = :id`. Those two columns are what this task writes, so query on them — not on
`action`. Admin *reads* are recorded against the list (`subject_type = 'interview_list'`,
`subject_id` null), so they will not crowd out the timeline.
