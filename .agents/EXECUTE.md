# EXECUTE — the execution prompt

For Sezai, Ahmet and Fatih. **This file is the prompt.** Paste it, or reference it:

> Please execute @.agents/EXECUTE.md, do relevant tasks. I am Sezai. If you face any
> problems, /superpowers:brainstorm to fix and update the task/ledgers.

Part 1 is what the agent obeys. Part 2 is what the humans need. Design reference:
`.agents/docs/IDEA.md`. Doc-authoring prompts: `.agents/prompts/AUTHOR_DOCS.md`.

---

# Part 1 — the prompt

## 1. Who you are

The invocation names you: Sezai, Ahmet or Fatih. **If it does not, stop and ask.** Never
guess — guessing writes to another person's ledger, and two people implementing
`schema.prisma` is the expensive version of that mistake.

| Person | Ledgers |
|---|---|
| Sezai | foundations `F03`, interview-core (`I01`–`I15`), frontend (`W01`–`W11`) |
| Ahmet | foundations `F01`, auth (`A01`–`A06`), report (`R01`–`R04`), speech (`S01`–`S10`), turn-taking (`T01`–`T04`), speech-latency (`L01`–`L04`) |
| Fatih | foundations `F02`, admin (`N01`–`N02`), voice (`V01`–`V05`), adaptive (`D01`–`D03`) |

Task-ID prefixes are unique per ledger — `F` foundations, `A` auth, `I` interview-core,
`R` report, `N` admin, `V` voice, `D` adaptive, `W` frontend (web), `S` speech, `T` turn-taking,
`L` speech-latency — so an ID alone tells you whose it is. Foundations is the one per-task split;
every other ledger belongs wholly to one person.

**speech supersedes voice (2026-08-06).** `V01`–`V05` stay `done` and are not reopened, but the
architecture under them was reversed by the owner — ElevenLabs is used for voice generation only,
with no agent and no webhooks. The replacement work is the `S` ledger
(`.agents/ledgers/speech/`, ADR-S01). Do not start a new `V` task.

**turn-taking supersedes ADR-S06's silence rule (2026-08-10).** `S01`–`S10` stay `done` and are
not reopened. What changed is narrower than the speech supersession above: silence still stops
the recorder, it just no longer ends the turn. The work is the `T` ledger
(`.agents/ledgers/turn-taking/`, ADR-T01). Start `T` tasks, not new `S` ones.

**turn-taking and speech-latency pull on the same files (2026-08-11).** `T` owns the pause, `L`
owns the seconds, and `L02`/`L03` name `T03`/`T04` in their `Depends on` for that reason — §4's
dependency rules already sequence them, so follow the graph rather than the ledger names.

**This table is the only authority on who owns what.** There is deliberately no `Owner`
column in any `STATE.md`: 50 cells to maintain where three rows already say it is 50 chances
to drift. Never work a task this table does not give you.

## 2. Preflight

```bash
git pull --rebase origin master
git status --porcelain
```

`git status --porcelain` must be empty. A dirty tree means a previous run's work is still
uncommitted; **stop and report it.** Verification against a dirty tree proves nothing, and
this file never commits, so the previous run's output is still sitting there waiting for a
human.

## 3. The dependency graph

```bash
awk -F'|' 'NF>=6 {
  id=$2; s=$5; d=$6
  gsub(/^[ \t]+|[ \t]+$/,"",id); gsub(/^[ \t]+|[ \t]+$/,"",s); gsub(/^[ \t]+|[ \t]+$/,"",d)
  if (id ~ /^[A-Z][0-9]+$/ && s ~ /^(todo|in_progress|done|blocked)$/) printf "%-4s %-12s <- %s\n", id, s, d
}' .agents/ledgers/*/STATE.md
```

50 lines: every task in the project, its status, and its complete direct-dependency list.
The `Depends on` column is machine truth — cross-ledger IDs included — so this one command
is the whole graph, and you never read another ledger's prose to find out what blocks you.

The status filter is not optional: it is what separates real task rows from the ID-shaped
rows in each ledger's narrative "Cross-ledger dependencies" tables. Without it those leak in
and the picture is wrong.

## 4. Pick your task

Apply these in order:

1. **A row of yours already `in_progress`?** Resume it. Finish what you started before you
   start anything else.
2. **Otherwise your task is the first row that is yours, `todo`, and has every ID in its
   `Depends on` at status `done`.** Order: `F` before `A` before `I` before `R` before `N`
   before `V` before `D` before `S` before `T` before `L`, then ascending number. (`S` has no
   `todo` rows left; `T` precedes `L` because `L02` and `L03` depend on `T03` and `T04`, so the
   tie-break and the dependency graph agree rather than fight.) Direct dependencies are enough —
   a dependency cannot be `done` unless its own dependencies were.
3. **Nothing eligible?** Walk your blocked row's dependencies until you reach a not-`done`
   task that is not yours, or one whose status is `blocked`. That is the root blocker — the
   one to chase, not the direct dependency. Print exactly:

   ```
   BLOCKED <your ID> needs <blocker ID> (<status>, owner <name>)
   ```

   and **end the run.** Do not pick a task from another ledger, do not work around it, do not
   start the blocker yourself — it is someone else's seat. Say it in the group chat.
4. **Every row of yours `done`?** Say so and end the run.
5. **A `Depends on` names an ID that appears in no row, or a chain loops back on itself?** The
   ledger contradicts itself. Print what you found and end the run — do not guess your way
   past it. That is a `/superpowers:brainstorm` job, which is what the invocation asks you to
   do with problems like this.

Worked example of rule 3: `A02` is blocked by `A01`, which is blocked by `F03`. `A01` is
Ahmet's own row, so the walk continues through it and reports
`BLOCKED A02 needs F03 (todo, owner Sezai)` — naming the task that actually has to move.

## 5. Check the tier before you start

Read the task's row in its ledger's `MODELS.md`:

- `claude-opus-*` → opus-tier. `claude-sonnet-*` → sonnet-tier.
- haiku, mini or flash anywhere in that row: **stop.** Banned for this repo.
- **The tier must match the model you are running.** If it does not, print
  `TIER <ID> needs <tier>, running <your model>` and end the run. The human relaunches on
  the right tier. Do not proceed on the wrong tier and note it in the devlog instead — the
  tier is a requirement, not a preference.

Practical consequence today: `F03` is sonnet-tier, so Sezai's first run must be a Sonnet
session.

## 6. The loop

For the task § 4 gave you:

1. Flip its `Status` to `in_progress` in that ledger's `STATE.md`.
2. Read that ledger's `REFERENCE.md` — **once per ledger per run**, not once per task. Trust
   it; patch it only if your task made it stale.
3. Read **only** that task's file under `tasks/`. Other task files belong to other sessions.
4. Do the work, ticking each `## Steps` checkbox as you go.
5. Run the task's `## Verification` command **exactly as written**. If it fails, fix the
   code — never the command. If it passes on the first run before you wrote any code, the
   test is wrong; fix the test.
6. Fill the task file's `## Notes` — hand-off content only, for the next session.
7. Flip the `STATE.md` row to `done`, repoint "Current task", rewrite "Last session ended".
8. Write `.agents/devlogs/<same basename as the task file>.md`. Not optional, not later. Full
   contract: Part 2 § Devlog.
9. **Stop. One task per session, no exceptions.** Do not re-run § 3/§ 4 to pick up another
   task in this same run — a session that finishes a task ends the run right there, even if
   another eligible same-tier task exists. Report what you did (§ 10) and end.

**Strictly one task per session.** A session is one task, start to finish: `in_progress` →
work → verification → `## Notes` → `done` → devlog → stop. Never chain a second task onto the
same run, whatever § 4 would hand you next. The human starts a fresh session for the next
task; that is the natural checkpoint for review before more work lands on top.

**Do not commit between tasks.** The working tree accumulates; the end-of-run report is what
makes it reviewable.

**One task at a time — do not dispatch subagents to run tasks concurrently.** Parallelism on
this project is three people on three seats, which the § 1 map makes conflict-free: no two
people's ledgers overlap, so no two runs write the same `STATE.md`. Inside a run there is no
isolation boundary — one working tree, no commits between tasks — so two concurrent agents
would interleave edits.

### ATDD ordering, non-negotiable

The feature file is written and **red** before implementation. IDEA.md §5.3:

1. Acceptance criterion → Gherkin.
2. Run → red. *See it red.* A test that was never red proves nothing.
3. Step definitions + implementation → green.
4. Vitest unit tests inside; Cucumber outside.
5. Refactor. The feature file did not change, so behaviour is preserved.

## 7. Gates

After the loop, if a root `package.json` exists:

```bash
npm run lint && npm run typecheck && npm test
npm run test:acceptance          # only if the run touched behaviour
```

If it does not exist — which is the case until F03 lands — **skip these and say so
explicitly in the report.** The task `## Verification` commands were the only gate that ran.
Silently skipping a gate is how a branch reaches CI red.

### Two CI jobs are currently false greens — read this before you trust them

CI (`.github/workflows/ci.yml`) went green on 2026-07-30 with two jobs that pass because
they have nothing to run, not because anything was proven:

- **`unit`** runs `vitest run --passWithNoTests`. The repo has zero vitest files. **The first
  session to write a vitest test must drop `--passWithNoTests` from
  `backend/package.json` → `test:unit`** in that same PR. Leave it in and every later run
  that finds no test files stays green.
- **`acceptance`** runs `cucumber-js` with no config file and no `backend/features/`
  directory, so it reports `0 scenarios` and exits 0. **The first ATDD session must add
  `cucumber.js` (or `cucumber.json`) and the `features/` + step-definition layout in the same
  PR as its first `.feature` file**, and confirm the job actually goes red before it goes
  green. `@cucumber/cucumber` and `vitest` are already installed as `backend` devDependencies
  — you do not need to add them, only to wire them.

A job that cannot fail is worse than a missing job: it reports safety it never checked. Both
are tracked in `.agents/ledgers/foundations/STATE.md` → `## Backlog`.

Also non-blocking on purpose: **`audit`** carries `continue-on-error: true`. `next` has an
unfixed high advisory (vulnerable range `9.3.4-canary.0 - 16.3.0-preview.7`; latest stable is
16.2.12, i.e. there is no fixed release to move to). Findings still print in the job log —
read them; do not add new high-severity dependencies on the strength of a green tick.

## 7b. Write short

Prose costs tokens and nobody reads it twice. Every word you write into a file is paid for on
every future run that reads that file.

- **Comments: default to none.** Write one only where the code cannot say it — a non-obvious
  *why*, a spec clause, a trap. Never restate what the line does. One line, not a paragraph. No
  banner headers, no section dividers, no doc-comment blocks on self-evident functions.
- **Docs: caveman-terse.** Drop articles, filler, hedging. Fragments fine. Bullets over prose,
  tables over bullets where they fit. Facts, not narration.
- **Keep the search keys.** Terse must stay greppable: name the ID, file, symbol, error code and
  event name exactly. `I06 must call ensureTechBatch (ADR-I22)` beats a well-turned paragraph
  that never says the function's name.
- **Budgets.** Task `## Notes` ≤ 40 lines. Devlog session block ≤ 40 lines. ADR ≤ 15 lines.
  STATE.md "Last session ended" ≤ 8 lines. Over budget means cut, not continue.
- **Never explain the same thing twice.** One home per fact, referenced from elsewhere by ID.
  A rationale in an ADR is not repeated in the code, the Notes and the devlog.
- Say what changed and why it is not obvious. Skip what the diff, the test output and
  `git log` already say.

## 8. Never

- Write prose where a fact fits (§ 7b). No essays in comments, Notes, devlogs or ADRs.
- Commit. Push. Open a PR. The human does all three.
- Work a task the § 1 map does not give you.
- Touch `schema.prisma` outside F02 (Part 2 § Migration protocol).
- Renumber or reuse a task ID. Scope changed? Append a new ID.
- Edit a past ADR entry. Decisions are append-only; a superseded ADR still explains why the
  code looks the way it does.
- Guess at credentials, API keys, external config, or a decision the team owns.

## 9. When you are blocked mid-task

1. Flip that ledger row to `blocked`.
2. Write it into that ledger's `STATE.md` → `## Open blockers`: what is needed, who can
   provide it, which task IDs it unblocks.
3. End the run and say it in the group chat. Do not silently switch to another task — § 4
   decides what is next, not you.

## 10. End-of-run report

State that the task is done — nothing more (no verification transcript, no file list, no
gates recap; those live in the devlog and `## Notes` already). Then give the human the exact
commands to finish, in order, using **Conventional Commits** (`type(scope): description` —
`feat`, `fix`, `chore`, `docs`, etc.; scope is the touched area, e.g. `frontend`, `ci`,
`backend`):

```bash
git switch -c <id>-<slug>
git add -A && git commit -m "$(cat <<'EOF'
<type>(<scope>): <short description>

Task: <ID>
EOF
)"
git push -u origin <id>-<slug>
gh pr create --title "<type>(<scope>): <short description>" --body "Task: <ID>"
```

Never run these — the human executes them.

Copilot code review takes the first pass. A **human on the team approves** — never
self-merge on an agent's approval alone.

---

# Part 2 — team reference

## The five rules

- **The ledger is the memory.** Nothing important lives in a chat transcript. If it
  mattered, it is in a file.
- **§ 4 decides what is next.** Not the "Current task" pointer, not you. One run drains one
  person's eligible same-tier chain and stops.
- **IDs are permanent addresses.** Never renumbered, never reused. Scope changed? Append a
  new ID.
- **Decisions are append-only.** A superseded ADR still explains why the code looks the way
  it does. Never edit a past entry.
- **Verification is a command, not a wish.** No task is done because it looks done.

---

## Devlog

`AI_DEVLOG.md` is a scored deliverable (IDEA.md §13) and it is judged on *transparency*.
A devlog assembled from memory at the end of the project reads like one, and loses the
points it was written to win. So it is not assembled at the end: **every session writes its
own devlog file, in the session.**

**One file per task ID:** `.agents/devlogs/<id>-<slug>.md`, where `<id>-<slug>` mirrors the
task's filename exactly — `tasks/A01-backend-auth-module.md` pairs with
`devlogs/A01-backend-auth-module.md`. Two reasons, both load-bearing:

- **No merge conflicts, ever.** Three people appending prose to one shared file on three
  branches conflict on every PR. A file named after a task ID is touched by exactly one
  owner on exactly one branch.
- **IDs are permanent addresses.** No date in the filename — a task that spans two
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

**Bullets, not essays — § 7b applies hardest here.** ≤ 40 lines per session block, each entry
one or two lines. Transparency is *which* thing went wrong and what you did about it, not how
well it is narrated. A grader skims; a padded devlog scores worse than a terse one.

Frontmatter is structured so the `AI_DEVLOG.md` summary table can be generated from the
heads alone, without parsing prose. Keep the five keys; add none.

- `model` vs `model_recommended` — the recommendation comes from `MODELS.md`. Part 1 § 5 ends
  the run on a tier mismatch rather than proceeding, so these should agree; if they ever
  differ, the prose says why. **Do not quietly align them.**
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
| every task, inside the run | the run | write or append `.agents/devlogs/<id>-<slug>.md` |
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
F03 workspaces · compose · Caddyfile · logger · env schema · CI  →  F01, F02, and everything
F01 design tokens · i18n scaffold · error-code registry          →  all UI work
F02 schema.prisma (full) · migrations · seed · repo helpers       →  all API work
```

**F03 goes first, alone.** F01's verification is `npm run -w @interviewly/types build`, which
needs the root workspace `package.json` F03 creates; F02's needs a live Postgres from F03's
`compose.yaml`. F03's own verification is `docker compose config`, which needs nothing. The
earlier "three tasks, three people, no cross-dependency, day one" reading was wrong, and the
`Depends on` column now says so.

Feature ledgers start when all three are green. Starting a feature ledger against a
half-landed F02 produces a migration you will have to unpick.

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
- **Rebase before merge**, always. `git pull --rebase origin master` then re-run
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
first run. An `EXECUTE.md` run does this for you when a root `package.json` exists and tells
you when it could not — until F03 lands, the task `## Verification` commands are the only
gate, so read the run's report before you push.

---

## When you are blocked

Do not guess at credentials, API keys, external config or a decision the team owns.

1. Flip the ledger row to `blocked`.
2. Write it into that ledger's `STATE.md` → `## Open blockers`: what is needed, who can
   provide it, and which task IDs it unblocks.
3. Say it in the group chat.
4. Do **not** pick up a different task. Part 1 § 4 decides what is next, and a blocked seat
   is a signal for the team, not a prompt to go find other work.

---

## Open blockers — team decisions, not agent decisions

These are from IDEA.md §15.1 and must be closed by a human.

| # | Blocker | Blocks | Decide by |
|---|---|---|---|
| 2 | **ElevenLabs agent provisioning** — hand-configured in the console, or created via API at startup? Console is less work now but makes `SETUP.md` depend on a manual step in someone else's dashboard. | `voice` ledger, `.env`, seed | before the voice spec |
| 3 | **ElevenLabs web SDK audio surface** — does it expose an `AudioNode`/`MediaStream` for agent output? Determines whether `AmplitudeAvatarDriver` exists at all. | avatar driver task only | before the frontend spec |

**Blocker 1 (branch name) is closed, 2026-07-30: `master`.** `upstream/HEAD` already pointed
at it and it was the only remote branch; the stale local `main` was deleted and the remote
was renamed `upstream` → `origin`, so every standard command and `gh` default works
unmodified. Blockers 2 and 3 gate `voice` tasks only — no voice task is eligible under
Part 1 § 4 until its dependencies are green anyway.

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

**Voice mode works on `localhost`.** S05 deleted the `cloudflared` tunnel with the webhooks
that needed it (ADR-S01/S03): ElevenLabs never calls us, `backend` calls ElevenLabs. Nothing
about voice needs public ingress any more.

Working on UI with no provider keys? `AI_ENABLED=false` skips provider validation and puts
the app in stub mode. Everything boots.
