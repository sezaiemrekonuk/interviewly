---
name: plan-initiative
description: Use when someone describes a product, feature set, MVP, migration, or rework in their own words and no task ledger exists for it yet — turns a product-manager-style ask into a durable `.{slug}/` initiative folder (PLAN, DECISIONS, STATE, REFERENCE, MODELS, EXECUTION_PROMPT, numbered task files) that fresh sessions can execute one task at a time without prior context.
---

# Plan an Initiative

Ledger-Driven Development (LDD), phase one.

## Overview

The user talks like a product manager. You do the engineering interrogation, the
architecture decisions, and the decomposition — then write it all down so that a
**fresh session with zero memory** can pick up any single task and finish it.

Core principle: **the ledger is the memory.** Nothing lives in the chat. If an
executing agent would need to ask a question, the answer belongs in a file.

<HARD-GATE>
Do NOT create the initiative folder, write any task file, or touch product code
until you have (a) interrogated the user, (b) presented the decision table +
phasing, and (c) received explicit approval. No exceptions for "simple" asks.
</HARD-GATE>

## When to use

- "I want to build X" / "here's what the app should do" / "we need to add billing"
- A vague product ask that will take more than one session to finish
- A rework or migration spanning several files or services
- **Not** for: a single bug fix, a one-file change, or work already in a ledger
  (use `update-initiative` for the latter).

## What you produce

```
.{slug}/
  PLAN.md              # architecture, decision table, phasing. Written once.
  DECISIONS.md         # append-only ADR log. Never edit past entries.
  STATE.md             # current task pointer + ledger + blockers + protocol
  REFERENCE.md         # codebase orientation (only if a codebase exists)
  MODELS.md            # recommended model per task (only if the user budgets models)
  EXECUTION_PROMPT.md  # pasteable prompt for a fresh session
  tasks/
    P01-slug.md ...    # one file per task
```

Templates for every one of these: `templates.md` in this skill's directory. Read
it before writing files, not before interrogating.

## Process

Create a todo per phase. Do them in order.

### Phase 1 — Orient (before asking anything)

Read, don't ask, what the repo already tells you:

- `CLAUDE.md` / `AGENTS.md` / `README.md`
- `git log --oneline -20`, the directory tree, `docker-compose.yml`, `Makefile`
- Any existing `.{slug}/` folders — if one exists and this ask belongs to it,
  **stop and use `update-initiative` instead**
- Package manifests, migration directory head, test layout

Wasting a question on something the repo states is the fastest way to lose the
user's patience. Ask only what the code cannot answer.

### Phase 2 — Interrogate (one question per message)

**One question at a time.** Prefer multiple choice via AskUserQuestion (always
lead with your recommendation, marked `(Recommended)`). Open-ended is fine when
the answer space isn't enumerable. Minimum 6 questions; keep going while answers
still change the design. Stop when the next question wouldn't change any file
you're about to write.

Cover these topics; skip any the user already answered or the repo settles:

| # | Topic | What you're actually extracting |
|---|-------|--------------------------------|
| 1 | Outcome | What is true for a user when this ships that isn't true today? |
| 2 | Invariant | What must never break, even at the cost of features? (safety, correctness, legal, data integrity) |
| 3 | Out of scope | What is explicitly *not* in this initiative? Write it down — it's the scope fence. |
| 4 | Hard constraints | Budget, latency, platform rules, compliance, offline, existing contracts |
| 5 | Topology | New service vs. extend existing? New repo vs. monorepo? Where does state live? |
| 6 | Identity/trust | Who is authenticated, what's the trust boundary, what may each role read/write? (skip if none) |
| 7 | Money | Metering, pricing unit, source of truth for balance (skip if none) |
| 8 | Done | How do we *prove* it works — the literal command or observation |
| 9 | Sequencing | What must ship first? What's the critical path? What can wait? |
| 10 | Execution budget | Which tasks deserve the expensive model, which are mechanical? |

Rules while interrogating:

- Never batch questions into a wall. One decision per message keeps answers sharp.
- When the user answers vaguely, restate it as a concrete commitment and confirm
  ("So: an export always writes a new file, never overwrites — yes?").
- **YAGNI ruthlessly.** Every "and also we could…" gets pushed to `Out of scope`
  or the Backlog unless the user defends it.
- If the ask spans several independent subsystems, say so immediately and offer
  to split it into separate initiatives rather than one bloated ledger.

### Phase 3 — Decide (2–3 options per real fork)

For each genuine architectural fork, present 2–3 approaches with trade-offs, your
recommendation first, and the reason. Get a pick. Each pick becomes an ADR.

A "real fork" is one where the wrong choice costs a rewrite. Don't stage a debate
over a filename.

### Phase 4 — Present for approval

Show, in the chat, before writing anything:

1. The **invariant**, one sentence, quoted.
2. The **decision table** — `| # | Decision | Chosen | Reason |`, one row per ADR.
3. The **phasing** — numbered clusters with task IDs.
4. The **ledger** — ID, title, depends-on, one line each.
5. What's **out of scope**.

Ask: "Approve this and I'll write the ledger?" Revise until yes. Do not proceed
on silence or a lukewarm answer.

### Phase 5 — Write the folder

Read `templates.md` now, then write every file. Non-negotiables:

- **Directory name**: `.{slug}/` at repo root, dot-prefixed, slug from the
  initiative not the product (`.payments-v2`, `.search-rework`).
- **ADR prefix**: unique across every ledger in this repo (`ADR-M01`, `ADR-P01`)
  so cross-references can never collide. Check existing folders first.
- **Task IDs**: `{Letter}{NN}`, zero-padded, dependency-sorted, never reused.
- **Every task file** carries: verbatim owner quote in `## Goal`, `file:line`
  anchors in `## Context`, checkbox `## Steps`, `## Definition of done`, and a
  literal runnable `## Verification` command. An empty `## Notes` heading waits
  at the bottom for the executing session.
- **`## Verification` is a command, not a wish.** `pytest -q tests -k billing`,
  not "confirm billing works". If it can't be a command, name the exact
  observation and the exact place to observe it.
- Never write a task whose file the executing agent could not finish without
  asking you a question.

### Phase 6 — Self-review, then stop

Re-read what you wrote with fresh eyes and fix inline:

- [ ] Any `TBD`, `TODO`, or hand-wave left in a task file? Fix it.
- [ ] Does every task's `Depends on` reference an ID that exists?
- [ ] Does every `## Verification` line actually run in this repo?
- [ ] Does PLAN.md's decision table match DECISIONS.md one-for-one?
- [ ] Does STATE.md's ledger list every file in `tasks/`, and vice versa?
- [ ] Could a stranger execute task 1 having read only STATE, REFERENCE, and
      that task file? If not, the gap goes into REFERENCE.md.

Then tell the user the folder is ready, paste the "Current task" line, and
**stop**. Do not roll into executing task 1 — that's a separate session with the
`EXECUTION_PROMPT.md` prompt.

## Task sizing

A task is the smallest unit that (a) carries its own verification command and
(b) a reviewer could reject on its own merits. Fold scaffolding, config, and
docs into the task that needs them. Split where a reviewer could reasonably
approve one half and reject the other.

Rules of thumb:
- One migration + the code that uses it = usually one task.
- Backend endpoint and its mobile screen = two tasks, different repos.
- "Set up CI" and "add the gate CI enforces" = two tasks, second depends on first.
- If a task file needs more than ~8 steps, it's two tasks.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Asking questions the repo answers | Phase 1 first. Read before you ask. |
| Batching 8 questions in one message | One per message. Answers degrade in batches. |
| Writing files before approval | Hard gate. Present the table, get a yes. |
| `## Verification`: "make sure it works" | A command with an expected result. |
| Task file that assumes chat context | The executing session has none. Anchor everything. |
| Renumbering tasks when scope changes | Append a new ID. IDs are permanent addresses. |
| Editing PLAN.md to change a decision | Append an ADR that supersedes; reference it from PLAN. |
| One giant ledger for four subsystems | Split into initiatives during Phase 2. |

## Red flags — stop and re-read this skill

- "I'll just scaffold the folder first and ask questions after"
- "This one's simple enough to skip the decision table"
- "I'll leave the verification command for the executing agent to figure out"
- "I'll write the task files now and fill in the anchors later"

All of these mean: back to the phase you skipped.
