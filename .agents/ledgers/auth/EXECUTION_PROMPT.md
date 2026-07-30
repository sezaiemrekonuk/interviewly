# Auth — Execution Prompt

Paste this verbatim as the prompt for each new session working the `.agents/ledgers/auth/`
ledger. One session = one task. The session has no memory of prior sessions — everything
needed lives in these files.

---

## Prompt (copy from here down)

You are executing one task from the Auth ledger in `.agents/ledgers/auth/`.
Follow this protocol exactly, in order. Do not skip steps, do not batch multiple tasks,
do not improvise scope beyond the task file.

1. **Read `.agents/ledgers/auth/STATE.md` in full** — ledger, statuses, cross-ledger
   dependencies, and the "Current task" pointer.

2. **Check the cross-ledger gate.** If the "Cross-ledger dependencies" table in STATE.md
   shows F01, F02, or F03 as anything other than `done` in the foundations ledger
   (`.agents/ledgers/foundations/STATE.md`), **stop and report**. Auth tasks cannot run
   until all three foundations tasks are green.

3. **Pick the task:**
   - If "Current task" names one, use it — unless the user's message this session names a
     different ID, in which case the user wins.
   - Otherwise take the first `todo` row in the ledger table whose `Depends on` is empty
     or all-`done`. Ties go to the earlier row (the table is dependency-sorted).
   - If nothing is eligible, stop and report — don't invent work.

4. **Read `.agents/ledgers/auth/REFERENCE.md` once.** Trust it; patch it if stale.

5. **Read only the current task's file** (e.g. `tasks/A01-*.md`). Other task files belong
   to other sessions.

6. **Check `.agents/ledgers/auth/MODELS.md`** for this task's recommended model. A01 and
   A02 require `claude-opus-4.8`. If you are not running that model on those tasks, say
   so before proceeding — auth is a security invariant and an under-powered model is a
   known risk.

7. **Do the work.** Tick each `## Steps` checkbox as you go. Stay in scope — note
   adjacent work in the STATE.md Backlog section, don't fold it in.

8. **Run the `## Verification` command exactly as written.** Don't claim done without
   seeing the Cucumber scenarios (or Playwright smoke for A03) pass. If they fail, fix
   the code — never the command. A test you silence is a security hole you hide.

9. **Mark it done:** fill the task file's `## Notes`; flip the STATE.md ledger row to
   `done`; repoint "Current task" to the next `todo` task; rewrite "Last session ended"
   with what actually landed, which files changed, and what the next task must know.

10. **Commit** as `{ID}: <title>`, e.g. `A01: Creating backend auth module`.
    Include the `.agents/ledgers/auth/` file changes in the same commit.

11. **STOP.** The next task is the next session's job.

### If blocked mid-task

Set the row to `blocked`, write the blocker into STATE.md's "Open blockers" section
(what's needed, which tasks it unblocks), and stop. Do not guess at credentials, env
variables, or external config the repo owner must supply.

### Guardrails that apply regardless of task

- **No password, token, `google_sub`, or session ID in any log line, error body, or test
  fixture.** Auth is the innermost trust boundary; leaking here costs the entire session
  model (K6, §7.2).
- **Admin restriction is checked twice** (K8): in the Google callback handler and in the
  session-issuance helper. A single check is not sufficient — the spec and the
  `admin_auth.feature` scenario both assert no session is created.
- **All error returns use codes from `error-codes.ts`**, never inline strings. If you
  discover a needed code missing from the registry, add it to `error-codes.ts` as part of
  your task steps before using it.
- **Migration rule (ADR-F02):** no new table, no column type change, no new enum value.
  A new index is a new migration file rebased on F02's migration, never an edit to the
  existing migration SQL.
- **Verification command is not negotiable.** `npm run test:acceptance -- --tags "…"` must
  exit 0 with the named scenarios passing. Do not skip or modify the command.

---

## Why this file exists

`STATE.md`'s "Execution protocol" is the source of truth (keep them in sync). This file
is the same protocol shaped as a standalone pasteable prompt, and it front-loads the
cross-ledger gate check and the security guardrails that apply to every auth task.
