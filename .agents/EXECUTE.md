# EXECUTE — how we run ledger tasks

For Sezai, Ahmet and Fatih. This is the team contract: how a task gets claimed, executed,
verified and merged, and the rules that keep three people working in parallel from
colliding.

**This file is not the execution prompt.** Each ledger ships its own
`.agents/ledgers/<slug>/EXECUTION_PROMPT.md` — that is what you paste into a fresh agent
session. This file is what *you* need to know before and after that session.

Design reference: `.agents/docs/IDEA.md`. Doc-authoring prompts: `.agents/prompts/AUTHOR_DOCS.md`.

---

## The five rules

- **The ledger is the memory.** Nothing important lives in a chat transcript. If it
  mattered, it is in a file and committed.
- **One session = one task.** Read STATE → read one task file → do it → verify → commit →
  stop. An agent that rolls into task two has stopped being reviewable.
- **IDs are permanent addresses.** Never renumbered, never reused. Scope changed? Append a
  new ID.
- **Decisions are append-only.** A superseded ADR still explains why the code looks the way
  it does. Never edit a past entry.
- **Verification is a command, not a wish.** No task is done because it looks done.

---

## Claiming work

Ledger rows carry an `Owner` column in `STATE.md`. To claim a task:

1. `git pull`
2. Put your name in that task's `Owner` cell and flip `Status` to `in_progress`.
3. Stage only, don't commit any changes.

Push the claim *before* you start working. A claim that lives on your laptop for an hour
is not a claim, and two people implementing `schema.prisma` is the expensive version of
this mistake.

**Claim a ledger, not a lone task.** The norm is one owner per ledger — you run its chain
task-by-task, one session each, until the slice is green. The per-task `Owner` column
exists so a dependent chain can be handed off cleanly, **not** so three people carve up one
feature into backend/frontend/db and then block each other. Do not claim a task whose
dependency is `in_progress` under someone else's name; pick an unblocked ledger instead.
Parallelism is three people on three *different* ledgers — `F01`–`F03` are the one
deliberate exception, three independent tasks in a single scope on day one.

If you need to drop a task, flip it back to `todo`, clear the Owner, push, and say so.

**Agent: if you don't know who you are, ask — don't guess.** The pointer and the `Owner`
column only tell you which task to pick once you know *whose* seat you're in. If the
session did not tell you your identity (Sezai, Ahmet or Fatih) — so you cannot tell which
`Owner` rows are yours or which pointer to follow — stop and ask the human, then **persist
the answer to memory** (`store_memory`) so the next session inherits it and you never
re-ask. Same for any other feature-level decision the ledger does not settle: ask once,
save it, reuse it.

---

## The loop

```bash
git pull
git switch -c <id>-<slug>            # e.g. f02-prisma-schema
```

Then open an agent session and paste `.agents/ledgers/<slug>/EXECUTION_PROMPT.md` verbatim.
The agent will:

1. Read `STATE.md` in full — ledger, statuses, Current task pointer.
2. Pick the task (the pointer, or your explicit ID, or the first eligible `todo`).
3. Read `REFERENCE.md` once.
4. Read **only** that task's file.
5. Check `MODELS.md` for the recommended tier.
6. Do the work, ticking `## Steps` checkboxes.
7. Run the task's `## Verification` command **exactly as written**.
8. Fill `## Notes`, update the STATE ledger row, repoint Current task, rewrite
   "Last session ended".
9. Write `.agents/devlogs/<id>-<slug>.md` — see § Devlog below. Not optional, not later.
10. Commit as `<id>: <title>`, including the ledger *and* devlog file changes.
11. **Stop.**

Then you:

```bash
npm run lint && npm run typecheck && npm test          # before you push, not after
npm run test:acceptance                                 # if the task touched behaviour
git push -u origin <id>-<slug>
gh pr create                                            # PR body links the task file
```

Copilot code review takes the first pass. A **human on the team approves** — never
self-merge on an agent's approval alone.

### ATDD ordering, non-negotiable

The feature file is written and **red** before implementation. IDEA.md §5.3:

1. Acceptance criterion → Gherkin.
2. Run → red. *See it red.* A test that was never red proves nothing.
3. Step definitions + implementation → green.
4. Vitest unit tests inside; Cucumber outside.
5. Refactor. The feature file did not change, so behaviour is preserved.

If a task's verification command passes on the first run before you wrote any code, the
test is wrong. Fix the test, never the command.

---

## Devlog

`AI_DEVLOG.md` is a scored deliverable (IDEA.md §13) and it is judged on *transparency*.
A devlog assembled from memory at the end of the project reads like one, and loses the
points it was written to win. So it is not assembled at the end: **every session writes its
own devlog file, in the session, and commits it with the task.**

**One file per task ID:** `.agents/devlogs/<id>-<slug>.md`, where `<id>-<slug>` mirrors the
task's filename exactly — `tasks/A01-backend-auth-module.md` pairs with
`devlogs/A01-backend-auth-module.md`. Two reasons, both load-bearing:

- **No merge conflicts, ever.** Three people appending prose to one shared file on three
  branches conflict on every PR. A file named after a task ID is touched by exactly one
  owner on exactly one branch.
- **IDs are permanent addresses** (rule 3). No date in the filename — a task that spans two
  sessions appends a second `## Session N` block to the *same* file rather than spawning a
  second one. Dates live in frontmatter; git has them anyway.

Sessions with no task ID — spec authoring, ledger writing, a debugging spike, the `eval`
run — are `.agents/devlogs/meta-<date>-<slug>.md`.

### The shape

```markdown
---
task: A01
author: Ahmet
sessions: [2026-08-04]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 3
tools: [superpowers:test-driven-development, context7, cavecrew-investigator]
---

## Session 1 — 2026-08-04

### What I asked for / what came back
### Methodology trace
spec §7.2 AC-2 → `auth.feature:41` → red (`INVALID_CREDENTIALS` undefined) → green
### Friction
### What I rejected and rewrote by hand
```

Frontmatter is structured so the `AI_DEVLOG.md` summary table can be generated from the
heads alone, without parsing prose. Keep the five keys; add none.

- `model` vs `model_recommended` — the recommendation comes from `MODELS.md`. If you
  switched mid-task, they differ, and the prose says why. **Those disagreements are the
  most useful content in the file.** Do not quietly align them.
- `iterations` — red→green cycles, counted honestly. `1` is a fine answer. So is `7`.
- `## What I rejected and rewrote by hand` — generated code you threw away, and why. This
  is the section that evidences the "code is owned, not accepted" criterion (§2, 5 points).
  A devlog where nothing was ever rejected is not a credible devlog.

### Devlog vs `## Notes` — different readers, no overlap

| | Reader | Contains |
|---|---|---|
| task `## Notes` | the next agent session | hand-off: what exists now, deviations from plan, verification output, "For A02" |
| devlog file | the grader, and us at write-up time | how the work was done: model, iterations, friction, what got rejected |

Do not duplicate between them. "Agent produced wrong argon2 params twice and I rewrote the
hashing call by hand" is devlog content; it has no business in a hand-off note.

### Cadence

| When | Who | What |
|---|---|---|
| every session, before the commit | task owner | write or append `.agents/devlogs/<id>-<slug>.md` |
| a ledger goes green | ledger owner | regenerate the `AI_DEVLOG.md` session table, write that ledger's narrative paragraph from its devlogs |
| before the demo | one person | `npm run eval` output, intro, methodology section, final read |

Root `AI_DEVLOG.md` is **compiled, never hand-linked** — hand-linking 25 entries
reintroduces the shared-file conflict one line at a time. It gets touched about seven times
by one person each time, not twenty-five times by three. The harvest prompt is
`.agents/prompts/AUTHOR_DOCS.md` § Stage 4. `DECISIONS.md` is compiled the same way, from
the ledgers' ADR logs plus IDEA.md §6, §10 and §11.

There is a sketch of a coverage check at `ci/check-devlogs.sh` — every `done` task has a
devlog file. **It is not wired into CI yet** (CI itself is F03). Until it is, this is a
human check at PR review: no devlog, no approval.

---

## What blocks what

```
F01 design tokens · i18n scaffold · error-code registry  →  all UI work
F02 schema.prisma (full) · migrations · seed · repo helpers  →  all API work
F03 workspaces · compose · Caddyfile · logger · env schema · CI  →  everything
```

Three tasks, three people, no cross-dependency, day one. **Feature ledgers start when all
three are green.** Starting a feature ledger against a half-landed F02 produces a migration
you will have to unpick.

Scope order after that (IDEA.md §12): MVP text mode → voice → bonus. The voice layer is
the attractive part and half the score sits in the mandatory functions. **If voice fails,
the project must still stand.**

---

## Migration protocol — read this before touching `schema.prisma`

`schema.prisma` is a single file and Prisma Migrate produces ordered, timestamped folders.
Three parallel ledgers each adding models produce colliding, out-of-order histories, and a
broken `docker compose up` on a fresh clone is the one failure IDEA.md §10 calls
unacceptable.

- **The entire schema lands in F02**, including tables no ledger has reached yet.
- Feature ledgers may add **indexes and nullable columns only**, each in its own migration.
- **Rebase before merge**, always. `git pull --rebase origin <main>` then re-run
  `npx prisma migrate dev` if the head moved.
- Any structural change — new table, dropped column, changed relation — is a change to
  **F02's scope**. It gets discussed in the group, recorded as an ADR, and merged as its
  own task. It does not ride along in a feature PR.

---

## Rules that apply to every task regardless

- **Language:** everything we author is English — code, comments, commits, specs, ledgers,
  task Notes. The product ships English UI with Turkish selectable; that is a different
  axis.
- **The API never returns display strings.** Stable error codes only; the frontend maps
  them. A test asserting English copy is a broken test.
- **Soft delete goes through the repository helper.** User-facing modules never call
  `prisma.interview.findMany` directly. Forgetting `deleted_at IS NULL` once leaks a
  deleted interview back into a user's list — a visible failure of a scored criterion.
- **Every log line** is `logger.<level>({ traceId, interviewId, … }, "EVENT_NAME")`.
  SCREAMING_SNAKE event name, structured first argument, no free-form sentences.
- **No secrets, tokens, PII or PDF content** in logs, error bodies, fixtures or commits.
- **No environment-conditional business logic.** Config may be env-driven; behaviour may
  not.
- **TypeScript `strict: true`.** An `any` needs a written justification in the PR.
- **Stay in scope.** Adjacent work you noticed goes in the ledger's Backlog section, not in
  your diff. Use `update-initiative` to promote it later.

---

## Commits and CI

Conventional Commits, enforced by commitlint. `<id>: <title>` is the ledger commit; feature
commits use the normal `feat(scope):` / `fix(scope):` form. The `commit-hygiene` job also
counts commits per branch (≥ 10, warning-only) — commit as you work rather than
manufacturing commits at the end.

CI on every PR, all blocking except the last:

| Job | Runs | Blocking |
|---|---|---|
| `lint` | ESLint + Prettier + `tsc --noEmit` | yes |
| `unit` | Vitest | yes |
| `acceptance` | Cucumber vs `api`, ephemeral Postgres + Redis, AI stubbed | yes |
| `build` | `docker compose build` | yes |
| `compose-check` | `docker compose config` | yes |
| `audit` | `npm audit --audit-level=high` | yes |
| `commit-hygiene` | commitlint + commit count | warning |

Run `lint`, `unit` and `acceptance` locally before pushing. CI is the safety net, not the
first run.

---

## When you are blocked

Do not guess at credentials, API keys, external config or a decision the team owns.

1. Flip the ledger row to `blocked`.
2. Write it into `STATE.md` → `## Open blockers`: what is needed, who can provide it, and
   which task IDs it unblocks.
3. Push, and say it in the group chat.
4. Pick up a different eligible task.

---

## Open blockers — team decisions, not agent decisions

These are from IDEA.md §15.1 and must be closed by a human.

| # | Blocker | Blocks | Decide by |
|---|---|---|---|
| 1 | **Branch name: `master` or `main`.** The remote and local clones disagree. Pick one, delete the other, before any parallel work. | every PR, every rebase | before F01–F03 start |
| 2 | **ElevenLabs agent provisioning** — hand-configured in the console, or created via API at startup? Console is less work now but makes `SETUP.md` depend on a manual step in someone else's dashboard. | `voice` ledger, `.env`, seed | before the voice spec |
| 3 | **ElevenLabs web SDK audio surface** — does it expose an `AudioNode`/`MediaStream` for agent output? Determines whether `AmplitudeAvatarDriver` exists at all. | avatar driver task only | before the frontend spec |

Blocker 1 is the live one. Two candidates for "the main branch" on a three-person team is a
merge accident waiting to happen, and nothing below F01 should start until it is settled.

---

## Local environment

```bash
docker compose up                                        # app only, ~900 MB
docker compose -f compose.yaml -f compose.dev.yaml up     # + host ports, hot reload, tunnel
docker compose --profile observability up                 # + elasticsearch, kibana (~2.7 GB)
docker compose run --rm api npm run seed                  # personas, demo admin, clusters
```

There is deliberately **no `compose.override.yaml`** — Compose loads that filename
automatically, which would silently publish `db`, `cache` and `bucket` on a bare
`docker compose up`. Dev extras live in `compose.dev.yaml` and are required explicitly
with `-f`.

**Voice mode does not work on `localhost` without the tunnel.** ElevenLabs cannot call
`http://localhost`, so the `cloudflared` service in the `dev` profile publishes the edge
and its hostname goes into `PUBLIC_ORIGIN`. This is the single most likely "why doesn't it
work on my machine" of the project.

Working on UI with no provider keys? `AI_ENABLED=false` skips provider validation and puts
the app in stub mode. Everything boots.
