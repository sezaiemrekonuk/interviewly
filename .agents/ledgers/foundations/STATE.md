# Foundations — State

Last updated: 2026-07-30
Last session ended: **F04 done** (executed by Sezai). Root `eslint.config.js` added
(`@typescript-eslint` recommended over `backend/src`, `packages/*/src`, `worker/src`;
`frontend/**` explicitly excluded since it lints itself). `npm run lint` at root now exits 0.
`husky` + `lint-staged` installed; `.husky/pre-commit` runs `npx lint-staged`, wired via
`"prepare": "husky"` and `core.hooksPath`. lint-staged blocks a bad commit under both
`backend/` (root config, `@typescript-eslint/no-unused-vars` is `error`) and `frontend/`
(`frontend/eslint.config.mjs`, required `--max-warnings=0` since `eslint-config-next`'s
`no-unused-vars` is only `warn`) — both verified live via real staged files + `git commit`
attempts, both blocked, no orphan commits. `npm ci` with no `.git` dir verified safe (husky's
install no-ops). All four workspaces (`backend`, `worker`, `packages/types`, `packages/ai`)
got a standalone `"lint"` script; caught a real bug along the way — flat-config `files` globs
resolve relative to `process.cwd()`, not the config file's location, so the first draft of
these scripts silently matched zero files (false green) until fixed to `cd` back to repo root
first. Full deviation record in `tasks/F04-precommit-hooks.md` → `## Notes`. F02 (Fatih) is
still open and independently eligible — F04 was off the critical path throughout.

Previously: **F01 done** (executed by Sezai, out of ownership order, as an explicit
blocker-clearing exception — see F01 task file `## Notes` for the full deviation record).
`frontend/` went from a bare Dockerfile to a real Next.js 16 App Router skeleton
(`create-next-app`), tokens/next-intl/error-codes/`@interviewly/types` all landed, 3 token
values (`--primary`, `--live`, `--text-muted`) were darkened to clear the 4.5:1 contrast
floor, and the error-code count was corrected 45→46 (the task's own literal list always had
46; only the prose annotations were stale). `npm run -w @interviewly/types build` exits 0,
`npm run typecheck` at root now passes (fixed a `baseUrl`/`jsx` gap in F03's root
`tsconfig.json` as part of F01 Step 10).

Previously: **F03 done.** Workspace root, compose files (default/dev/observability),
Caddyfile, `.env.example`, backend+worker logger/env, CI workflow, Dockerfile skeletons all
landed. `docker compose config` exits 0; `grep -n "ports:" compose.yaml` shows exactly one
match (`edge`); `grep -c "service_completed_successfully" compose.yaml` = 2.

## Execution protocol (follow exactly)

Do not start from this file. `.agents/EXECUTE.md` is the prompt, and its § 4 decides which
task is yours — not the "Current task" pointer below, which is a human-readable summary and
can lag.

Read this file → read `REFERENCE.md` once → read only the task § 4 gave you →
check `MODELS.md` for the required tier and stop if it is not yours → do the work, ticking
checkboxes → run the task's `## Verification` command verbatim → fill in the task's
`## Notes` → update this file's ledger row, "Current task" pointer, and "Last session ended"
line → write `.agents/devlogs/{ID}-<slug>.md` (EXECUTE.md § Devlog) → **do not commit** →
re-apply EXECUTE.md § 4 and continue with what it gives you.

## Current task

**F01, F03, F04 are done. F02 (Fatih) is the only foundations task left, still `todo` — it
blocks every feature ledger (`Depends on` includes F02 across `I`, `A`, `R`, `N`, `V`, `D`).
Foundations has no more tasks for Sezai.** Apply `.agents/EXECUTE.md` Part 1 § 4 to confirm
before starting anything.

## Environment

Nothing is installed yet. Each task's `## Steps` lists the exact commands to set up its
own scope. A fresh clone needs only `node` ≥ 22 and Docker Desktop installed. The
`compose.yaml` does not exist until F03 lands; F01 and F02 can be verified without it
(see their individual `## Verification` commands).

## Open blockers / decisions for the user

None at ledger-write time. The two open questions in the `ui` spec (styling layer choice,
optional second `speaking` avatar) are decided or deferred in ADR-F01 and F01's task
steps. The `voice` CSP open question does not block foundations.

## Task ledger (F01–F04)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| F01 | Creating design tokens, next-intl scaffold, error-code registry, and @interviewly/types package | | done | F03 |
| F02 | Creating full Prisma schema, migrations, seed, and soft-delete repo helpers | | todo | F03 |
| F03 | Creating npm workspaces root, compose.yaml, Caddyfile, logger, env schema, and CI workflow | | done | — |
| F04 | Local pre-commit hooks (husky + lint-staged) for backend, frontend, packages | | done | F03 |

## Critical path

**F03 → {F01, F02} in parallel** → all three green → every feature ledger (auth,
interview-core, report, admin, voice, adaptive) may start.

The earlier "three tasks, three people, no cross-dependency, day one" reading was wrong:
F01 and F02 cannot run their own verification commands until F03 exists, and rule 5 is that
verification is a command, not a wish.

**F04 is off the critical path.** It depends only on F03 (done) and gates nothing — no feature
ledger's `Depends on` names F04. It exists so local commits get caught before CI does; land it
whenever Sezai picks it up, in parallel with F02.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **Root `"test"` script missing.** `npm test` at repo root fails ("Missing script"). Only
  `test:acceptance` is wired; no aggregate unit-test script exists yet (backend has its own
  `test:unit` via vitest, scoped to its workspace). Promote alongside the `unit` CI job once a
  second workspace has tests to aggregate.
- **`@interviewly/ai` package implementation** — F03 wires the `packages/ai/` entry in
  `package.json`; the package body is empty until the `ai` ledger claims it. Promote when
  the ai ledger is authored.
- **`compose.dev.yaml` hot-reload mounts** — F03 creates the file with the `tunnel`
  service; bind-mount configuration for hot reload can be added without a structural
  change. Promote when a developer reports a DX pain point.
- **Elasticsearch / Kibana Compose wiring** — `observability` profile services; F03 creates
  the skeleton. Full index-template and dashboard config deferred to a parallel
  observability task outside MVP scope.
