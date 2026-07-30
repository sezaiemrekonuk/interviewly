# Report — Execution Prompt

Paste this verbatim as the prompt for each new session working the `.agents/ledgers/report/`
ledger. `.agents/EXECUTE.md` is the prompt; its § 4 picks the task and its § 6 drains the chain. The session has no memory of prior sessions — everything needed
lives in these files.

---

## Prompt (copy from here down)

You are executing one task from the Report ledger in `.agents/ledgers/report/`.
Follow this protocol exactly, in order. Do not skip steps, do not batch multiple tasks, do not
improvise scope beyond the task file.

1. **Read `.agents/ledgers/report/STATE.md` in full** — ledger, statuses, cross-ledger
   dependencies, and the "Current task" pointer.

2. **Do not pick the task yourself.** Apply `.agents/EXECUTE.md` Part 1 § 4: the assignment
   map, the dependency dump, and the five rules. Work the ID it gives you. If a rule ends the
   run, print its line and stop. The "Current task" pointer in `STATE.md` is a
   human-readable summary and can lag behind the `Depends on` column, which is the truth.
3. **Task selection already happened in step 2.** `.agents/EXECUTE.md` Part 1 § 4 gave you
   the ID; work that one. Do not re-derive it from the "Current task" pointer, and do not
   fall back to "the first `todo` row" — that reading ignores cross-ledger dependencies the
   `Depends on` column now carries in full.

4. **Read `.agents/ledgers/report/REFERENCE.md` once.** Trust it; patch it if stale.

5. **Read only the current task's file** (e.g. `tasks/R01-*.md`). Other task files belong to
   other sessions.

6. **Check `.agents/ledgers/report/MODELS.md`** for this task's recommended model. R03 requires
   `claude-opus-4.8` (retry/dead-letter correctness). If you are not running that model on R03,
   say so before proceeding.

7. **Do the work.** Tick each `## Steps` checkbox as you go. Stay in scope — note adjacent work
   in the STATE.md Backlog section, don't fold it in. In particular: **do not re-implement
   `runReport`, the `ReportPayload` schema gate, or the `evaluating → completed | failed`
   transition** — they are I09's and you call them (PLAN.md scope boundary).

8. **Run the `## Verification` command exactly as written.** Don't claim done without seeing it
   pass. The report acceptance path is `npm run test:acceptance -- --tags "@report"`; worker-
   observable behaviour is `npm run -w worker test`. If it fails, fix the code — never the
   command.

9. **Mark it done:** fill the task file's `## Notes`; flip the STATE.md ledger row to `done`;
   repoint "Current task" to the next `todo` task; rewrite "Last session ended" with what
   actually landed, which files changed, and what the next task must know.

10. **Write your devlog:** create `.agents/devlogs/<basename of the task file>` — same
    basename, so `tasks/R01-worker-report-consumer.md` pairs with
    `devlogs/R01-worker-report-consumer.md`. Feeds the scored `AI_DEVLOG.md`
    deliverable; written now, in this session, because nobody reconstructs it later.

    ```markdown
    ---
    task: R01
    author: <Sezai | Ahmet | Fatih — ask if you were not told; do not guess>
    sessions: [YYYY-MM-DD]
    model: <the model that actually ran>
    model_recommended: <what MODELS.md said>
    iterations: <red→green cycles, counted honestly>
    tools: [<skills, MCPs, subagents you used>]
    ---

    ## Session 1 — YYYY-MM-DD

    ### What I asked for / what came back
    ### Methodology trace
    spec §… AC-n → `<feature file>:<line>` → red (<the failure>) → green
    ### Friction
    ### What I rejected and rewrote by hand
    ```

    If `model` and `model_recommended` differ, the prose must say why you switched — those
    disagreements are the most useful content in the file, so do not quietly align them.
    The last section is what evidences that the code is owned rather than accepted; if you
    genuinely rejected nothing, say so and say why. This is a **different document from the
    task's `## Notes`**: Notes hand off to the next session, the devlog reports how the work
    was done. Do not duplicate between them. Full contract: `.agents/EXECUTE.md` § Devlog.

11. **Do not commit.** Report the files you changed and the verification output; the human
    commits, pushes and opens the PR. See `.agents/EXECUTE.md` Part 1 § 10.
12. **Re-apply `.agents/EXECUTE.md` Part 1 § 4** and continue with what it gives you. Stop
    when a rule there ends the run, or when § 5 says the next task needs a different tier.

### If blocked mid-task

Set the row to `blocked`, write the blocker into STATE.md's "Open blockers" section (what's
needed, which tasks it unblocks), and stop. Don't guess at credentials, bucket config, or a
`runReport`/`applyTransition` signature the interview-core owner must confirm — read the code.

### Guardrails that apply regardless of task

- **A report is delivered only after its `ReportPayload` passed I09's schema gate.** Do not
  render, store, or mark `ready` a report whose payload `runReport` did not persist. (K15, §5.5)
- **`interviews.state` is written only through `applyTransition` (I07).** The worker never issues
  a raw `prisma.interview.update({ data: { state } })` — that bypasses the guarded transition
  table and can drive an illegal edge. (K2)
- **`jobId = interviewId`.** The producer's idempotency and "exactly one report job per
  interview" (AC-20) depend on it. Every consumer path must be safe to run twice (a retry
  re-runs the processor). Finalise is an upsert, never a blind insert. (K10)
- **A schema-gate `failed` is never retried; a transient throw is.** `runReport` sets `failed`
  and returns without throwing on a schema-invalid payload — that job is complete. Only a thrown
  error is retried (3 attempts, backoff) then dead-lettered `→ failed`. Do not convert a schema
  failure into a retry. (ADR-R04, K10)
- **No `payload`, PDF bytes, signed URL, transcript, PII or secret in any log line.** (K6, §7.2)
- **Migration rule (ADR-F02):** no new table, no column type change, no new enum value. A new
  index is a new migration file rebased on F02's migration, never an edit to the existing SQL.
- **Verification command is not negotiable.** It must exit 0 with the named scenarios/tests
  passing. Do not skip or modify the command.

---

## Why this file exists

`STATE.md`'s "Execution protocol" is the source of truth (keep them in sync). This file is the
same protocol shaped as a standalone pasteable prompt, and it front-loads the cross-ledger gate
check and the scope-boundary guardrail (never re-implement `runReport`) that applies to every
report task.
