# Adaptive — Execution Prompt

Paste this verbatim as the prompt for each new session working the `.agents/ledgers/adaptive/`
ledger. One session = one task. The session has no memory of prior sessions — everything
needed lives in these files.

---

## Prompt (copy from here down)

You are executing one task from the Adaptive ledger in `.agents/ledgers/adaptive/`.
Adaptive is the **bonus band (§12)**: a score-driven next-question feature that blocks no
other ledger. Follow this protocol exactly, in order. Do not skip steps, do not batch
multiple tasks, do not improvise scope beyond the task file.

1. **Read `.agents/ledgers/adaptive/STATE.md` in full** — ledger, statuses, the two
   cross-ledger tables, the critical path, and the "Current task" pointer.

2. **Check the cross-ledger gate.** Adaptive depends on foundations and interview-core. If
   the "Cross-ledger dependencies (blocks this ledger)" table shows any dependency of the
   task you're about to run as not `done` in its own ledger STATE — F01/F02/F03 in
   `.agents/ledgers/foundations/`, or I01/I02/I04/I06 in
   `.agents/ledgers/interview-core/` — **stop and report.** In particular:
   - D01 needs F01, F02, F03, **I01** (the `Scores` schema) green.
   - D02 needs F01, F02, F03, **I01, I02, I04** green.
   - D03 needs D01, D02, **I06, I02** green.

3. **Pick the task:**
   - If "Current task" names one, use it — unless the user's message this session names a
     different ID, in which case the user wins.
   - Otherwise take the first `todo` row in the ledger table whose `Depends on` is empty or
     all-`done`. Ties go to the earlier row (the table is dependency-sorted).
   - If nothing is eligible, stop and report — don't invent work.

4. **Read `.agents/ledgers/adaptive/REFERENCE.md` once.** Trust it; patch it if stale.

5. **Read only the current task's file** (e.g. `tasks/D01-*.md`). Other task files belong to
   other sessions.

6. **Check `.agents/ledgers/adaptive/MODELS.md`** for this task's recommended model. D01 and
   D03 require `claude-opus-4.8` (they interpret or guard a score). If you are not running
   that model on those tasks, say so before proceeding — the malformed-score guard is the
   invariant and an under-powered model is a known risk.

7. **Do the work.** Tick each `## Steps` checkbox as you go. Stay in scope — note adjacent
   work in the STATE.md Backlog section, don't fold it in.

8. **Run the `## Verification` command exactly as written.** For D01/D02 it is a runnable
   `npx tsx …selftest.ts` that must exit 0; for D03 it is
   `npm run test:acceptance -- --tags "@adaptive-questions"` and both `@AC-12` scenarios must
   pass. If it fails, fix the code — never the command. A test you silence is a guard you
   hide.

9. **Mark it done:** fill the task file's `## Notes`; flip the STATE.md ledger row to `done`;
   repoint "Current task" to the next `todo` task; rewrite "Last session ended" with what
   actually landed, which files changed, and what the next task must know.

10. **Write your devlog:** create `.agents/devlogs/<basename of the task file>` — same
    basename, so `tasks/D01-adaptive-selector.md` pairs with
    `devlogs/D01-adaptive-selector.md`. Feeds the scored `AI_DEVLOG.md`
    deliverable; written now, in this session, because nobody reconstructs it later.

    ```markdown
    ---
    task: D01
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

11. **Commit** as `{ID}: <title>`, e.g. `D01: Adaptive score→question selector`.
    Include the `.agents/ledgers/adaptive/` and `.agents/devlogs/` file changes in the same commit.

12. **STOP.** The next task is the next session's job.

### If blocked mid-task

Set the row to `blocked`, write the blocker into STATE.md's "Open blockers" section (what's
needed, which tasks it unblocks), and stop. Do not stub out I01/I02/I04/I06 to unblock
yourself — if the interview-core seam isn't green, the adaptive task isn't ready.

### Guardrails that apply regardless of task

- **The invariant, above all:** a malformed or schema-invalid answer score must never select
  a graded next question. A score that fails the `Scores` schema (I01) → the `fallback`
  outcome, a 200 response, the default next row, and a `LLM_FALLBACK_TRIGGERED` log — never a
  thrown error to the client and never a graded pick. K4 is additive; it can never break the
  MVP interview flow (§3.7).
- **AI calls only through `AiClient`** (the I02 adapter in request context). Never import a
  provider SDK; never re-implement `scoreAnswer`/`generateCandidates`. Adaptive re-validates
  `Scores` only at the point it reads `overall` — the belt-and-braces of the invariant.
- **No transcript, question/candidate text, score `reasons`, provider key, or PII in any log
  line, error body, or test fixture** (K6, §7.2). Log `questionId` and `chosen_reason`, not
  content.
- **The difficulty label is never surfaced to the user** (K4). It lives on the `questions`
  row for admin/audit only.
- **No new error code** — the malformed path is a 200 fallback, not a client error.
- **Migration rule (ADR-F02 / ADR-D):** no structural schema change in this ledger. Adaptive
  reads/writes existing F02 columns only. A new index would be a new migration file rebased on
  F02's, never an edit to existing migration SQL.
- **Verification command is not negotiable.** It must exit 0 with the named checks passing.
  Do not skip or modify it.

---
