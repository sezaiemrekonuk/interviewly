---
name: update-initiative
description: Use when an initiative ledger (a `.{slug}/` folder with STATE.md, PLAN.md, DECISIONS.md, tasks/) already exists and something must change — a new feature request or complaint from the owner, a task to add, split, re-scope, block, unblock or retire, a decision to record or supersede, a backlog item to promote, or a stale REFERENCE.md — without renumbering IDs, editing past ADRs, or rewriting finished work.
---

# Update an Initiative

Ledger-Driven Development (LDD), the amendment path.

## Overview

The ledger is the project's memory. Updating it is an **append operation**, not
an edit. History that turned out to be wrong gets superseded and dated, never
overwritten — future sessions read the record to understand why the code looks
the way it does, and a rewritten record lies to them.

Core principle: **IDs are permanent addresses.** Task IDs, ADR numbers, and
migration numbers are referenced from commit messages, Notes sections, and other
task files. Renumbering breaks every one of those references silently.

File shapes live in `../plan-initiative/templates.md`. Read it before writing a
new task file or ADR.

## When to use

- "The app should also do X" / "X is annoying, fix it" / "add Y to the plan"
- A finished session's work changed the plan for later tasks
- A decision changed: new benchmark, new price, new platform rule
- A task is blocked, obsolete, too big, or was wrong
- A backlog item's trigger fired
- `REFERENCE.md` no longer matches the code

Not for: *executing* a task (use the ledger's own `EXECUTION_PROMPT.md`), creating
a ledger that doesn't exist yet (use `plan-initiative`), or recording a one-off
decision in a repo that has no ledger at all.

## Phase 1 — Orient

1. `ls` the repo root for `.{slug}/` folders. More than one? Pick by subject
   matter and say which you picked. Ask only if genuinely ambiguous.
2. Read `STATE.md` **in full** — ledger, statuses, blockers, backlog, and the
   "Last session ended" narrative.
3. Read `PLAN.md`'s decision table and `DECISIONS.md`'s headings (not every body).
4. Read task files **only** for the tasks this change touches. Never the folder.

## Phase 2 — Classify the change

Route before you write. Wrong route is the whole failure mode here.

| The user says | Route |
|---|---|
| New capability, fits the initiative's goal | New task, next free ID, appended |
| New capability, different subsystem/goal | New initiative — offer `plan-initiative` |
| "Later, maybe" / no trigger yet | Backlog line in STATE.md, unnumbered |
| Changes a task that is `todo` | Edit that task file in place |
| Changes a task that is `done` | **New task.** Never reopen a done row. |
| Changes an architectural choice | New ADR that supersedes the old one |
| Task turned out too big | Split: keep the ID for the first half, append a new ID for the rest |
| Task is obsolete | Status `retired` + one line in the file saying which ADR or task killed it. Don't delete the file. |
| Waiting on the owner | Status `blocked` + an entry in "Open blockers" naming what's needed |
| Code moved, docs stale | Patch `REFERENCE.md`, note the date it was re-verified |

## Phase 3 — Interrogate (only what the task file can't be written without)

The owner speaks in outcomes. A task file needs specifics. Ask **one question per
message**, only for what's missing — typically 2–4 questions, not the full
`plan-initiative` interview.

You may not write a new task file until you have all five:

1. **The verbatim ask.** The owner's own words, to quote in `## Goal`. If they
   were vague, get one concrete sentence and read it back for confirmation.
2. **The boundary.** What this must not break or change. Usually inherited from
   PLAN.md's invariant — restate it in the task's own terms.
3. **The anchors.** `file:line` for every place the change lands. **You** find
   these by grepping, not by asking. Grep every caller, not just the one the
   complaint names — the sibling call sites are the classic silent miss.
4. **The verification.** A literal runnable command with an expected result.
5. **The tier.** Which model this deserves, per `MODELS.md`'s own rule of thumb.

Then confirm the plan in one short message before writing: the ID, the title,
where it sits in the ledger, what it depends on, and what it deliberately leaves
alone.

## Phase 4 — Write, atomically

Every update touches **at least two files**: the thing you changed and
`STATE.md`. A change that isn't in the ledger doesn't exist.

Adding a task:
- [ ] Create `tasks/{ID}-{slug}.md` from the template. Next free ID — **append,
      never insert between existing numbers** even if the dependency order wants
      it. The `Depends on` column encodes order; the number encodes birth order.
- [ ] Add the ledger row in `STATE.md`, with real dependencies.
- [ ] If it changes the architecture: append an ADR, then add its row to
      `PLAN.md`'s decision table with a pointer. `PLAN.md` prose changes only to
      reference the new ADR.
- [ ] If it changes phasing: update PLAN.md's cluster list and STATE.md's
      critical path.
- [ ] Add a `MODELS.md` row if that file exists.
- [ ] Repoint "Current task" only if this task should genuinely run next.
- [ ] Update "Last updated". Leave "Last session ended" alone unless you executed
      something — it records execution, not planning.

Recording a decision:
- [ ] New dated ADR with the next number. Its `**Context:**` must name **what
      changed** since the superseded entry — a measurement, a price, a platform
      rule. "We reconsidered" is not a context.
- [ ] Never edit the superseded entry. Add `(supersedes {ADR-X})` to the new
      title and note in `**Consequences:**` that older task Notes quoting the old
      decision were true when written.
- [ ] Update PLAN.md's decision table row to the new choice, referencing the
      new ADR.

Promoting a backlog item:
- [ ] Delete the backlog line, create the task, add the ledger row. The backlog
      entry's stated trigger must actually have fired — say which one and how.

## Phase 5 — Verify the ledger is still coherent

- [ ] Every `Depends on` ID exists and isn't `retired`
- [ ] No duplicate IDs; no gaps caused by renumbering
- [ ] `tasks/` files and ledger rows are one-to-one
- [ ] PLAN.md's decision table matches DECISIONS.md one-for-one
- [ ] STATE.md's "Execution protocol" and `EXECUTION_PROMPT.md` still agree
- [ ] "Open blockers" contains only genuinely open items
- [ ] Nothing you wrote requires chat context to understand

Report what changed in a few lines, then **stop**. Writing the task is not
executing it — that's a fresh session with `EXECUTION_PROMPT.md`.

## Common mistakes

| Mistake | Fix |
|---|---|
| Reading every file in `tasks/` | STATE.md plus the touched tasks. Nothing else. |
| Renumbering to keep dependency order tidy | Append the ID; encode order in `Depends on`. |
| Editing a past ADR "since it's wrong now" | Supersede with a dated entry. |
| Reopening a `done` task | New task. The done row and its Notes are history. |
| "Fixing" a previous session's Notes | Notes are a record of what happened, not of what's true now. |
| Deleting a retired task file | Status `retired` + why. Deletion orphans every reference. |
| Adding a task without a ledger row | Two files minimum, always. |
| Anchoring only the file the complaint named | Grep every caller first. |
| Folding a second feature into the same task | Two asks = two tasks. |

## Red flags — stop

- "I'll add the ledger row later"
- "This is basically the same as {done task}, I'll just extend it"
- "The old ADR is just wrong, I'll correct it"
- "I'll write the task now and find the anchors while executing"
- "I'll renumber so the order reads nicely"
