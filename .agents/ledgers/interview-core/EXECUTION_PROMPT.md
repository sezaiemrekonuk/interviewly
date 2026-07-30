# Interview-core — Execution Prompt

Paste this verbatim as the prompt for each new session working the
`.agents/ledgers/interview-core/` ledger. `.agents/EXECUTE.md` is the prompt; its § 4 picks the task and its § 6 drains the chain. The session has no memory
of prior sessions — everything needed lives in these files.

---

## Prompt (copy from here down)

You are executing one task from the Interview-core ledger in
`.agents/ledgers/interview-core/`. Follow this protocol exactly, in order. Do not skip
steps, do not batch multiple tasks, do not improvise scope beyond the task file.

1. **Read `.agents/ledgers/interview-core/STATE.md` in full** — ledger, statuses,
   cross-ledger dependencies, critical path, and the "Current task" pointer.

2. **Do not pick the task yourself.** Apply `.agents/EXECUTE.md` Part 1 § 4: the assignment
   map, the dependency dump, and the five rules. Work the ID it gives you. If a rule ends the
   run, print its line and stop. The "Current task" pointer in `STATE.md` is a
   human-readable summary and can lag behind the `Depends on` column, which is the truth.
3. **Task selection already happened in step 2.** `.agents/EXECUTE.md` Part 1 § 4 gave you
   the ID; work that one. Do not re-derive it from the "Current task" pointer, and do not
   fall back to "the first `todo` row" — that reading ignores cross-ledger dependencies the
   `Depends on` column now carries in full.

4. **Read `.agents/ledgers/interview-core/REFERENCE.md` once.** Trust it; patch it if stale.

5. **Read only the current task's file** (e.g. `tasks/I01-*.md`). Other task files belong
   to other sessions.

6. **Check `.agents/ledgers/interview-core/MODELS.md`** for this task's recommended model.
   Ten tasks (I01, I02, I04, I05, I06, I07, I08, I09, I11, I12) require `claude-opus-4.8` —
   they carry the prompt-injection, cost, or state-machine invariant. If you are not running
   that model on one of them, say so before proceeding; an under-powered model is a known
   risk on those tasks.

7. **Do the work.** Tick each `## Steps` checkbox as you go. Stay in scope — note adjacent
   work in the STATE.md Backlog section, don't fold it in.

8. **Run the `## Verification` command exactly as written.** Don't claim done without seeing
   the named Cucumber scenarios pass. If they fail, fix the code — never the command, never
   the tags. A test you silence is an invariant you break.

9. **Mark it done:** fill the task file's `## Notes`; flip the STATE.md ledger row to `done`;
   repoint "Current task" to the next eligible `todo` task; rewrite "Last session ended" with
   what landed, which files changed, and what the next task must know.

10. **Write your devlog:** create `.agents/devlogs/<basename of the task file>` — same
    basename, so `tasks/I01-interviewly-ai-scaffold.md` pairs with
    `devlogs/I01-interviewly-ai-scaffold.md`. Feeds the scored `AI_DEVLOG.md`
    deliverable; written now, in this session, because nobody reconstructs it later.

    ```markdown
    ---
    task: I01
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
needed, which tasks it unblocks), and stop. Do not guess at provider keys, bucket
credentials, or external config the repo owner must supply — with `AI_ENABLED=false` every
AI-dependent task runs against `StubAiClient` and needs no real key.

### Guardrails that apply regardless of task

- **No AI call is billed except through `AiClient`, and every attempt writes one `llm_calls`
  row** (stub mode too, `cost_usd = 0`). A call with no row, or a second charge slipped
  outside the budget transaction, is a cost-invariant defect (K2, K9, §7.3).
- **Attacker text never becomes an instruction.** Job listings, transcripts and candidate
  profiles reach the LLM only through `PromptBuilder` — role-separated, neutralised,
  truncated. An injection match logs, it does not block; the schema is the barrier (§7.1).
- **The API owns progression.** `current_index` advances only via the guarded
  `updateMany … WHERE current_index = $expected`; `count === 0` is `QUESTION_NOT_CURRENT`.
  State changes only through the transition table; an illegal edge is
  `INVALID_STATE_TRANSITION`, never a silent write (K2).
- **A not-owned `:id` is `INTERVIEW_NOT_FOUND` (404), never 403** (ADR-I11). Never leak the
  existence of another user's interview, report, or upload.
- **All error returns use codes from `error-codes.ts`**, never inline strings. If a needed
  code is missing from the registry, add it there as part of your task steps before use.
- **Log shape** is `logger.<level>({ traceId, interviewId }, "EVENT_NAME")`. Never log a
  listing body, transcript, provider key, or signed URL (§7.2).
- **Migration rule (ADR-F02 / ADR-I):** no new table, no column type change, no new enum
  value. A new index or nullable column is a new migration file rebased on F02's migration,
  never an edit to the existing migration SQL.
- **Verification command is not negotiable.** `npm run test:acceptance -- --tags "…"` must
  exit 0 with the named scenarios passing. Never verify a shared feature file by `@AC-n`
  alone — scope it by its area tag as the task file's command already does.

---

## Why this file exists

`STATE.md`'s "Execution protocol" is the source of truth (keep them in sync). This file is
the same protocol shaped as a standalone pasteable prompt, and it front-loads the
cross-ledger gate check and the cost / prompt-injection / state-machine guardrails that
apply to every interview-core task.
