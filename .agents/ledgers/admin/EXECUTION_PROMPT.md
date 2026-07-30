# Admin — Execution Prompt

Paste this verbatim as the prompt for each new session working the
`.agents/ledgers/admin/` ledger. One session = one task. The session has no memory of prior
sessions — everything needed lives in these files.

---

## Prompt (copy from here down)

You are executing one task from the Admin ledger in `.agents/ledgers/admin/`.
Follow this protocol exactly, in order. Do not skip steps, do not batch multiple tasks,
do not improvise scope beyond the task file.

1. **Read `.agents/ledgers/admin/STATE.md` in full** — ledger, statuses, cross-ledger
   dependencies, and the "Current task" pointer.

2. **Check the cross-ledger gate.** If the "Cross-ledger dependencies" table in STATE.md
   shows any cited task (F01, F02, F03, A01, A02, I03, I06, I08) as anything other than
   `done` in its own ledger's STATE.md, **stop and report**. Admin tasks cannot run until
   every dependency in the current task's `Depends on` row is green. In particular, an admin
   session cannot be obtained until **A02** is green, and the admin cost list has no cost to
   read until **I08** is green.

3. **Pick the task:**
   - If "Current task" names one, use it — unless the user's message this session names a
     different ID, in which case the user wins.
   - Otherwise take the first `todo` row in the ledger table whose `Depends on` is empty or
     all-`done`. Ties go to the earlier row (the table is dependency-sorted).
   - If nothing is eligible, stop and report — don't invent work.

4. **Read `.agents/ledgers/admin/REFERENCE.md` once.** Trust it; patch it if stale.

5. **Read only the current task's file** (e.g. `tasks/N01-*.md`). Other task files belong to
   other sessions.

6. **Check `.agents/ledgers/admin/MODELS.md`** for this task's recommended model. N01
   requires `claude-opus-4.8` (admin-role trust boundary + soft-delete-audit correctness). If
   you are not running that model on N01, say so before proceeding — a leaked deleted row or an
   open `/admin/*` surface is a 5-point security regression.

7. **Do the work.** Tick each `## Steps` checkbox as you go. Stay in scope — note adjacent
   work in the STATE.md Backlog section, don't fold it in. Do **not** re-implement the
   admin-must-use-password rule — `admin_auth.feature` is owned by auth A02 (ADR-N04).

8. **Run the `## Verification` command exactly as written.** Don't claim done without seeing
   the Cucumber scenario pass. If it fails, fix the code — never the command. A test you
   silence is a security hole you hide.

9. **Mark it done:** fill the task file's `## Notes`; flip the STATE.md ledger row to `done`;
   repoint "Current task" to the next `todo` task; rewrite "Last session ended" with what
   actually landed, which files changed, and what the next task must know.

10. **Write your devlog:** create `.agents/devlogs/<basename of the task file>` — same
    basename, so `tasks/N01-admin-role-gate-soft-delete-audit.md` pairs with
    `devlogs/N01-admin-role-gate-soft-delete-audit.md`. Feeds the scored `AI_DEVLOG.md`
    deliverable; written now, in this session, because nobody reconstructs it later.

    ```markdown
    ---
    task: N01
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

11. **Commit** as `{ID}: <title>`, e.g. `N01: Admin-role gate + soft-delete audit path`.
    Include the `.agents/ledgers/admin/` and `.agents/devlogs/` file changes in the same commit.

12. **STOP.** The next task is the next session's job.

### If blocked mid-task

Set the row to `blocked`, write the blocker into STATE.md's "Open blockers" section (what's
needed, which tasks it unblocks), and stop. Do not guess at credentials, env variables, or
external config the repo owner must supply, and do not stub out a missing cross-ledger
dependency to "make progress".

### Guardrails that apply regardless of task

- **A soft-deleted interview must never appear in `GET /me/interviews`, and must always appear
  in `GET /admin/interviews` with `deleted: true` and unchanged cost** (K11, K13). This is the
  ledger invariant; `admin_cost.feature` @AC-17 asserts both directions.
- **`/admin/*` is reachable only by `requireAuth` → `requireAdmin`.** A non-admin gets `403
  FORBIDDEN`; the gate is a single chokepoint on the admin router (ADR-N01), never a
  copy-pasted per-handler check.
- **Admin reads bypass `userInterviews()` deliberately and say so** — every direct
  `prisma.interview.findMany` carries the `ADMIN AUDIT` comment (ADR-N02). It is the only
  sanctioned direct `findMany`; do not add one outside `modules/admin/`.
- **Do not re-implement admin auth.** `admin_auth.feature` @AC-4 is auth A02's (ADR-N04).
- **All error returns use codes from `error-codes.ts`**, never inline strings. This ledger
  needs no new codes — `FORBIDDEN`, `INTERVIEW_NOT_FOUND`, `UNAUTHENTICATED` are all in F01.
- **No PII, tokens, or per-user cost breakdowns in any log line, error body, or test fixture.**
  `interviewId` + `traceId` are the K6 keys.
- **Migration rule (ADR-F02):** no new table, no column type change, no new enum value. The
  only write this ledger performs is `interviews.deleted_at = now()` against F02's existing
  column. Any index is a new migration file rebased on F02, never an edit to the existing SQL.
- **Verification command is not negotiable.** `npm run test:acceptance -- --tags "@admin-cost
  and @AC-…"` must exit 0 with the named scenario passing. Do not skip or modify the command.

---

## Why this file exists

`STATE.md`'s "Execution protocol" is the source of truth (keep them in sync). This file is
the same protocol shaped as a standalone pasteable prompt, and it front-loads the cross-ledger
gate check (especially A02 for the admin session and I08 for the cost data) and the
security/soft-delete guardrails that apply to every admin task.
