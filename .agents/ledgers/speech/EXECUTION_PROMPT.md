# Speech — Execution Prompt

Paste this verbatim as the prompt for each new session working the `.agents/ledgers/speech/`
ledger. `.agents/EXECUTE.md` is the prompt; its § 4 picks the task and its § 6 drains the
chain. The session has no memory of prior sessions — everything needed lives in these files.

---

## Prompt (copy from here down)

You are executing one task from the Speech ledger in `.agents/ledgers/speech/`. Follow this
protocol exactly, in order. Do not skip steps, do not batch multiple tasks, do not improvise
scope beyond the task file.

1. **Read `.agents/ledgers/speech/STATE.md` in full** — ledger, statuses, cross-ledger
   dependencies, the "Current task" pointer, and "Open blockers".

2. **Do not pick the task yourself.** Apply `.agents/EXECUTE.md` Part 1 § 4: the assignment
   map, the dependency dump, and the five rules. Work the ID it gives you. If a rule ends the
   run, print its line and stop. The "Current task" pointer is a human-readable summary and can
   lag behind the `Depends on` column, which is the truth.

3. **Task selection already happened in step 2.** Do not re-derive it, and do not fall back to
   "the first `todo` row" — that reading ignores the cross-ledger dependencies the `Depends on`
   column carries in full.

4. **Read `.agents/ledgers/speech/REFERENCE.md` once.** Trust it; patch it only if stale.

5. **Read only the current task's file** (e.g. `tasks/S01-*.md`). Other task files belong to
   other sessions.

6. **Check `.agents/ledgers/speech/MODELS.md`** for this task's tier. S04, S05 and S06 require
   opus — money, the ceiling, and the turn loop. If you are not running that tier on those
   tasks, print `TIER <ID> needs <tier>, running <your model>` and end the run.

7. **Do the work.** Tick each `## Steps` checkbox as you go. Stay in scope — consume I06/I07/I08,
   never reimplement the state machine, the guarded advance, or the budget transaction. Note
   adjacent work in STATE.md's Backlog, don't fold it in.

8. **Run the `## Verification` command exactly as written.** If it fails, fix the code — never
   the command. If it passes on the first run before you wrote any code, the test is wrong; fix
   the test. A ceiling test that cannot fail is a spend cap you removed.

9. **Mark it done:** fill the task file's `## Notes`; flip the STATE.md ledger row to `done`;
   repoint "Current task"; rewrite "Last session ended" with what landed, which files changed,
   and what the next task must know.

10. **Write your devlog:** create `.agents/devlogs/<basename of the task file>` — same
    basename, so `tasks/S01-speech-provider-seam.md` pairs with
    `devlogs/S01-speech-provider-seam.md`. Feeds the scored `AI_DEVLOG.md` deliverable; written
    now, in this session, because nobody reconstructs it later.

    ```markdown
    ---
    task: S01
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

    If `model` and `model_recommended` differ, the prose must say why you switched. The last
    section is what evidences that the code is owned rather than accepted; if you genuinely
    rejected nothing, say so and say why. This is a **different document from the task's
    `## Notes`**: Notes hand off to the next session, the devlog reports how the work was done.
    Full contract: `.agents/EXECUTE.md` § Devlog.

11. **Do not commit.** Report the files you changed and the verification output; the human
    commits, pushes and opens the PR.

12. **Re-apply `.agents/EXECUTE.md` Part 1 § 4** and continue with what it gives you. Stop when
    a rule there ends the run, or when § 5 says the next task needs a different tier.

### If blocked mid-task

Set the row to `blocked`, write the blocker into STATE.md's "Open blockers" (what's needed,
which tasks it unblocks), and stop. Do not guess at the ElevenLabs API key, the persona
`voice_id` values, or the TTS/STT model names — those are the owner's to supply.

### Guardrails that apply regardless of task

- **The API key never reaches the browser.** Both provider calls are server-side (ADR-S02). A
  payload, header or bundle exposing `ELEVENLABS_API_KEY` client-side is a defect.
- **No key, no audio bytes, no transcript text** in any log line, error body, or test fixture
  (K6, §7.2).
- **The ceiling is server-side, on every provider call.** Elapsed against
  `interviews.started_at`; past it, no provider call, `time_exhausted`, `VOICE_SESSION_EXPIRED`
  (ADR-S06). The client's VAD is never the enforcement.
- **Candidate audio is transient** (ADR-S07). Memory only, discarded after transcription. Never
  object storage, never a DB column. Only the transcript persists.
- **Downgrade is one-directional.** `interviews.mode` goes `voice → text` only, never back
  (§3.8). Consume `downgradeToText`; do not add a second path.
- **Every provider call is billed inside `withBudget`** — the `llm_calls` insert and the
  `spent_usd` increment share one transaction (I08, K13). A failed call bills nothing.
- **Consume, don't reimplement.** I06 owns answer persistence, I07 the transition table, I08
  the budget transaction. Extend them through their published surface only.
- **Migration rule (ADR-F02):** this ledger's one schema change is the `voice_sessions` drop, in
  its own migration rebased on F02. Nothing else.
- **Verification is not negotiable.** The task's command must exit 0 with the named scenarios
  passing, and a skipped acceptance ring is reported as skipped, never as green.

---

## Why this file exists

`STATE.md`'s "Execution protocol" is the source of truth (keep them in sync). This file is the
same protocol shaped as a standalone pasteable prompt, and it front-loads the speech-specific
guardrails — key-never-in-browser, server-side ceiling, transient audio, one-directional
downgrade, billing inside the budget transaction — that apply to every task in this ledger.
