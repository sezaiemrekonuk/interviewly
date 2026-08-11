# Turn-taking — Execution Prompt

Paste this verbatim as the prompt for each new session working the `.agents/ledgers/turn-taking/`
ledger. `.agents/EXECUTE.md` is the prompt; its § 4 picks the task and its § 6 drains the chain.
The session has no memory of prior sessions — everything needed lives in these files.

---

## Prompt (copy from here down)

You are executing one task from the Turn-taking ledger in `.agents/ledgers/turn-taking/`. Follow
this protocol exactly, in order. Do not skip steps, do not batch multiple tasks, do not improvise
scope beyond the task file.

1. **Read `.agents/ledgers/turn-taking/STATE.md` in full** — ledger, statuses, cross-ledger
   dependencies, the "Current task" pointer, and the tech-debt list.

2. **Do not pick the task yourself.** Apply `.agents/EXECUTE.md` Part 1 § 4: the assignment map,
   the dependency dump, and the five rules. Work the ID it gives you. If a rule ends the run,
   print its line and stop. The "Current task" pointer is a human-readable summary and can lag
   behind the `Depends on` column, which is the truth.

3. **Task selection already happened in step 2.** Do not re-derive it, and do not fall back to
   "the first `todo` row".

4. **Read `.agents/ledgers/turn-taking/REFERENCE.md` once.** Trust it; patch it only if stale.
   It carries every anchor these four tasks need, including three "do not simplify this back"
   traps in the room that already cost a session once.

5. **Read only the current task's file** (e.g. `tasks/T01-*.md`). Other task files belong to
   other sessions.

6. **Check `.agents/ledgers/turn-taking/MODELS.md`** for this task's tier. T02, T03 and T04
   require opus — the atomic take, the two ceilings, and the client state machine. If you are not
   running that tier on those tasks, print `TIER <ID> needs <tier>, running <your model>` and end
   the run.

7. **Do the work.** Tick each `## Steps` checkbox as you go. Stay in scope — consume I06/I07/I08
   and C02, never reimplement the state machine, the guarded advance, the budget transaction or
   the conductor's guards. Note adjacent work in STATE.md's Backlog, don't fold it in.

8. **Run the `## Verification` command exactly as written.** If it fails, fix the code — never
   the command. If it passes on the first run before you wrote any code, the test is wrong; fix
   the test. A test for "the turn always ends" that cannot fail is a candidate left in silence.

9. **Mark it done:** fill the task file's `## Notes`; flip the STATE.md ledger row to `done`;
   repoint "Current task"; rewrite "Last session ended" with what landed, which files changed,
   and what the next task must know.

10. **Write your devlog:** create `.agents/devlogs/<basename of the task file>` — same basename,
    so `tasks/T01-completeness-gate.md` pairs with `devlogs/T01-completeness-gate.md`. Format and
    contract: `.agents/EXECUTE.md` § Devlog. Written now, in this session, because nobody
    reconstructs it later.

11. **Do not commit.** Report the files you changed and the verification output; the human
    commits, pushes and opens the PR.

12. **Re-apply `.agents/EXECUTE.md` Part 1 § 4** and continue with what it gives you. Stop when a
    rule there ends the run, or when § 5 says the next task needs a different tier.

### If blocked mid-task

Set the row to `blocked`, write the blocker into STATE.md (what's needed, which tasks it
unblocks), and stop. Do not invent the gate's prompt wording from scratch if the task file gives
it, and do not guess at threshold or timeout numbers — ADR-T01 and ADR-T03 fix them.

### Guardrails that apply regardless of task

- **The turn always ends.** The gate may only *delay* a submission, never prevent one. The 13 s
  clock, the 8-probe cap and the 6 000-character cap each end it independently, and a gate that
  cannot answer forwards rather than holds. Any change that makes one of those three the *only*
  thing standing between a candidate and permanent silence is a defect.
- **The voice route never accepts candidate text.** `POST /turns/audio` takes `audio` and
  `force` and nothing else. A `pending`, `text` or `transcript` field on that route is the exact
  finding ADR-T02 exists to prevent — a candidate posting words they never spoke into the
  utterance the conductor answers and the report scores.
- **Fail open, always.** Gate throw, gate timeout, malformed gate output, `BudgetExceeded`, Redis
  unreachable — every one of them forwards the utterance. Degrade to today's product, never to a
  room that has stopped talking.
- **No held-partial text in any log line, error body or test fixture** (K6). Log its length and
  the probe count; never its content. It is candidate speech.
- **Every provider call is billed inside `withBudget`** — the `llm_calls` insert and the
  `spent_usd` increment share one transaction (I08, K13). A failed call bills nothing. The gate
  is a provider call.
- **Consume, don't reimplement.** C02 owns the conductor and its five guards, I06 the guarded
  advance, I07 the transition table, I08 the budget transaction, S01 the speech seam. Extend them
  through their published surface only.
- **One Redis connection.** `redis` from `backend/modules/auth/rate-limit.ts`. Never a second.
- **No migration.** `chat_messages.action` is free text and already carries three values;
  `silence` joins them. A migration in this ledger means you took a wrong turn.
- **Verification is not negotiable.** The task's command must exit 0 with the named scenarios
  passing, and a skipped acceptance ring is reported as skipped, never as green. Acceptance runs
  from the host, with port overrides and a **throwaway** Redis — a shared cache leaks a held
  partial from one scenario into the next.

---

## Why this file exists

`STATE.md`'s "Execution protocol" is the source of truth (keep them in sync). This file is the
same protocol shaped as a standalone pasteable prompt, and it front-loads the guardrails specific
to this ledger — the turn always ends, no text on the voice route, fail open, one Redis
connection — because those are the four ways this work goes wrong quietly.
