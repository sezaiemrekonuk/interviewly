# Foundations — Execution Prompt

Paste this verbatim as the prompt for each new session working the
`.agents/ledgers/foundations/` ledger. One session = one task. The session has no memory
of prior sessions — everything needed lives in these files.

---

## Prompt (copy from here down)

You are executing one task from the **Foundations** ledger in
`.agents/ledgers/foundations/`. Follow this protocol exactly, in order. Do not skip
steps, do not batch multiple tasks, do not improvise scope beyond the task file.

1. **Read `.agents/ledgers/foundations/STATE.md` in full** — ledger, statuses, and the
   "Current task" pointer.
2. **Pick the task:**
   - If "Current task" names one and the user's message this session does not override it,
     use it.
   - Otherwise take the first `todo` row whose `Depends on` is `—` or all-`done`. In this
     ledger all three rows have `Depends on: —`, so the first `todo` row by ID is eligible.
   - If a `Repo` column named another repo, confirm you are in it before doing anything
     else.
   - If nothing is eligible, stop and report — don't invent work.
3. **Mark the task `in_progress`** in `STATE.md` before touching any other file.
4. **Read `.agents/ledgers/foundations/REFERENCE.md` once.** Trust it; patch it only if
   stale after your task lands.
5. **Read only the current task's file** under `tasks/`. Other task files belong to other
   sessions.
6. **Check `.agents/ledgers/foundations/MODELS.md`** for this task's recommended model.
   If you are not running it, state so before proceeding.
7. **Do the work.** Tick each `## Steps` checkbox as you go. Stay in scope — note adjacent
   work in STATE.md's Backlog, don't fold it in.
8. **Run the `## Verification` command exactly as written.** Do not claim done without
   seeing it pass. If it fails, fix the code — never the command.
9. **Mark it done:** fill the task file's `## Notes`; flip the STATE.md ledger row to
   `done`; repoint "Current task"; rewrite "Last session ended".
10. **Write your devlog:** create `.agents/devlogs/<basename of the task file>` — same
    basename, so `tasks/F01-design-tokens-types-i18n-errors.md` pairs with
    `devlogs/F01-design-tokens-types-i18n-errors.md`. Feeds the scored `AI_DEVLOG.md`
    deliverable; written now, because nobody reconstructs this later.

    ```markdown
    ---
    task: F01
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

    A `model` differing from `model_recommended` needs the reason in prose — do not quietly
    align them. The last section evidences that the code is owned rather than accepted; if
    you rejected nothing, say so and why. **Different document from the task's `## Notes`**:
    Notes hand off to the next session, the devlog reports how the work was done. No
    duplication. Full contract: `.agents/EXECUTE.md` § Devlog.

11. **Commit** as `{ID}: <title>`, e.g. `F01: design tokens, next-intl scaffold,
    error-code registry, @interviewly/types`. Include the `.agents/ledgers/foundations/`
    and `.agents/devlogs/` file changes in the same commit.
12. **STOP.** The next task is the next session's job.

### If blocked mid-task

Set the row to `blocked`, write the blocker into STATE.md's "Open blockers" section (what
is needed, which tasks it unblocks), and stop. Do not guess at credentials, API keys, or
external config the owner supplies.

### Guardrails that apply regardless of task

- `docker compose up` on a clean clone must yield a working, seeded, single-origin app
  after all three tasks are done — do not author a step that requires a manual action
  beyond `docker compose run --rm api npm run seed`.
- `schema.prisma` is a single file. The entire schema lands in F02. F01 and F03 do not
  touch it. If you find yourself editing `schema.prisma` from F01 or F03, stop — that is
  scope drift.
- No secrets committed. `.env.example` uses placeholder values only.
- No `process.env` reads outside the validated Zod config object (F03 creates it; F01 and
  F02 may read from it once it exists, but do not add raw reads).
- Every log line: `logger.<level>({ traceId, interviewId, …fields }, "EVENT_NAME")`.
  No free-form sentence strings in log calls.

---

## Why this file exists

`STATE.md`'s "Execution protocol" is the source of truth (keep them in sync). This file
is the same protocol shaped as a standalone pasteable prompt, and it front-loads task
*selection*, which STATE.md assumes you already know.
