# Foundations — State

Last updated: 2026-08-03
Last session ended: **F03 packaging repair** (Sezai, 2026-08-03 — no new task row; F03's own
Dockerfiles, reopened because the api image never booted). The three defects
`auth/STATE.md` recorded as (6)(7)(8) are fixed and **that BLOCKER can be closed by its
owner** — a `docker compose up -d --wait` now brings every service healthy and the api runs
`node backend/dist/src/index.js`, not `tsx`. What changed: `backend/tsconfig.json` and
`worker/tsconfig.json` pin `paths: {}` + `rootDir` (the root config's `paths` pulled
`packages/*/src` into the program, sliding tsc's inferred root to the repo root and the emit
to `dist/backend/src/`); `@interviewly/ai` is a declared dependency of backend so `npm ci
--workspace=` actually links it into the image; `packages/ai` entry points moved to `dist/`
(`main: "src/index.ts"` was a TypeScript file plain `node` cannot load), with the root
`vitest.config.mts` aliasing back to `src` so unit tests never read a stale build. All three
Dockerfiles rebuilt on `base → deps → build / prod-deps → runner`: cache-mounted `npm ci`,
`--omit=dev` runner, `--chown=node:node`, and a `test -f <CMD target>` assertion so a future
rootDir drift fails the build instead of crash-looping a container. The Prisma CLI moved to
backend `dependencies` — the `migrate` service runs out of that same now-dev-free image. Two
finds nobody reported: `.dockerignore` patterns were anchored at the context root (so
`node_modules`/`.next` never matched a workspace) and **`.env` was being baked into every
image layer**; and the acceptance suite `TRUNCATE`d whatever `DATABASE_URL` named, which is
how the seeded demo admin kept disappearing (guard + `interviewly_test` in `db/init.sql`).
Verified: 4/4 images build, stack healthy, `/api/healthz` ok, login 200 + `/api/me` admin,
rings 33/33 + 11/11, 97 unit, lint + typecheck clean from a tree with no `dist/` anywhere.

Previously: **F02 done** (executed by Sezai, out of ownership order — F02 is Fatih's
row, taken over on the owner's request as an explicit blocker-clearing exception, the same
pattern as F01; full deviation record in `tasks/F02-prisma-schema-migrate-seed.md` → `## Notes`).
**Foundations is now green and every feature ledger is unblocked.** `backend/prisma/schema.prisma`
holds all 15 tables, 18 enums and the 7 §8.1 indexes; migration `20260730130638_init` is
generated and applied; `prisma/seed.ts` is idempotent and produces the demo admin, 10 occupation
clusters, 2 personas, the 5-pose mascot set, the sample-listing fixture and one finished sample
interview with a ready report; `backend/src/lib/db.ts` ships `userInterviews`, `activeInterview`
and `recordLlmCall` plus a self-check that was proven red before being trusted. Verification
(`prisma migrate diff --exit-code`) exits 0, all 17 FKs are `ON DELETE RESTRICT` with no cascade
delete, and the whole path was re-run from destroyed volumes so "on an empty database" was
literally tested. **Prisma is 6.19.3, not the task's `^5`** — ADR-F13. Five one-line changes
landed outside `backend/prisma`, each needed for a fresh clone to boot seeded: `compose.yaml`
(`migrate` gets `--schema`), `backend/Dockerfile` (`prisma generate`), `eslint.config.js` and
`tsconfig.json` (both now reach `backend/prisma/*.ts`), `.env.example` (`SEED_ADMIN_PASSWORD`).
`npm run lint` and `npm run typecheck` exit 0; `npm test` still does not exist (backlog, below).

Previously: **F04 done** (executed by Sezai). Root `eslint.config.js` added
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

**Foundations is green. F01, F02, F03, F04 are all `done` — there is no next foundations
task for anyone.** Every feature ledger (`auth`, `interview-core`, `report`, `admin`, `voice`,
`adaptive`) is now unblocked at its root: `A01`, `I01`, `I14`, `I15` and `D01` have all of
`F01`/`F02`/`F03` satisfied. Apply `.agents/EXECUTE.md` Part 1 § 4 against your own ledger.

## Environment

A fresh clone needs `node` ≥ 22 and Docker Desktop, then `npm ci` and
`cp .env.example .env`. All four foundations tasks have landed, so the stack is real:

```bash
docker compose up                                         # full stack; migrate runs itself
docker compose run --rm api npm run seed                   # personas, clusters, demo admin

# Host-side loop against just the two stateful services:
docker compose -f compose.yaml -f compose.dev.yaml up -d db bucket
cd backend
export DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly
export SHADOW_DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly_shadow
export S3_ENDPOINT=http://localhost:9000 S3_BUCKET=interviewly \
       S3_ACCESS_KEY=minioadmin S3_SECRET_KEY=minioadmin
npx prisma migrate deploy && npm run seed && npm run db:check
```

`.env` is gitignored and its `DATABASE_URL` is container-side (`db:5432`) — host-side Prisma
needs the `localhost` overrides above, which is why they are exported rather than written into
the file. Demo admin: `admin@demo.com` / `AdminDemo1!`.

## Open blockers / decisions for the user

None at ledger-write time. The two open questions in the `ui` spec (styling layer choice,
optional second `speaking` avatar) are decided or deferred in ADR-F01 and F01's task
steps. The `voice` CSP open question does not block foundations.

## Task ledger (F01–F05)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| F01 | Creating design tokens, next-intl scaffold, error-code registry, and @interviewly/types package | | done | F03 |
| F02 | Creating full Prisma schema, migrations, seed, and soft-delete repo helpers | | done | F03 |
| F03 | Creating npm workspaces root, compose.yaml, Caddyfile, logger, env schema, and CI workflow | | done | — |
| F04 | Local pre-commit hooks (husky + lint-staged) for backend, frontend, packages | | done | F03 |
| F05 | Edge `/assets/*` bucket-path rewrite + MinIO anonymous-read policy scoped to `mascot/*`+`personas/*` | | done | F02, F03 |

## Critical path

**Walked, in order: F03 → F01 → F04 → F02. All four are green, so the critical path is
clear** and every feature ledger (auth, interview-core, report, admin, voice, adaptive) may
start.

The earlier "three tasks, three people, no cross-dependency, day one" reading was wrong:
F01 and F02 cannot run their own verification commands until F03 exists, and rule 5 is that
verification is a command, not a wish. In the end F03/F01/F04/F02 ran sequentially rather than
in parallel — the three-seat split never materialised on foundations, and all four were
executed by Sezai.

**F04 is off the critical path.** It depends only on F03 (done) and gates nothing — no feature
ledger's `Depends on` names F04. It exists so local commits get caught before CI does; land it
whenever Sezai picks it up, in parallel with F02.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **`lint` typechecks with the wrong tsconfig.** The `lint` job runs `tsc --noEmit -p
  tsconfig.json` (root: `module: esnext`), but `build` compiles `backend/tsconfig.json`
  (`module: commonjs`). A backend file can be root-clean and build-red — I08 shipped a
  top-level `await` that passed `lint` and failed the docker `build` on TS1378. Promote when
  someone wants the two jobs to agree: `lint` should run each workspace's own `build`
  typecheck, not the root one.
- **`unit` CI job is a false green.** `backend/package.json` → `test:unit` is
  `vitest run --passWithNoTests`, because the repo has no vitest files and `vitest run`
  exits 1 on an empty suite. Promote — i.e. delete the flag — in the same PR as the first
  vitest test. Also flagged in `.agents/EXECUTE.md` § 7 so every session sees it.
- **`acceptance` CI job is a false green.** `cucumber-js` runs with no config file and no
  `backend/features/` directory, reports `0 scenarios`, exits 0. Needs `cucumber.js` +
  `features/` + step definitions. Promote in the same PR as the first `.feature` file, and
  see the job go red first (EXECUTE.md § 6, ATDD ordering). `@cucumber/cucumber` and `vitest`
  are already `backend` devDependencies — only the wiring is missing.
- **`npm audit` is non-blocking.** The `audit` job carries `continue-on-error: true`. Cause:
  `next` itself has a high advisory whose vulnerable range (`9.3.4-canary.0 -
  16.3.0-preview.7`) covers every stable release including the current latest, 16.2.12 — so
  there is nothing to upgrade to. The other 11 highs *are* fixable and are collateral of the
  same tree: `postcss` (≤8.5.17, fix 8.5.18+) and `sharp` (<0.35.0, fix 0.35.3) can be forced
  with root `overrides`, and the eslint chain (`eslint`, `@eslint/config-array`,
  `@eslint/eslintrc`, `brace-expansion`, `minimatch`, `eslint-config-next`) needs an eslint 9
  → 10 major bump. Both were left alone deliberately: overriding `sharp` under `next` risks
  image optimisation at runtime, and an eslint major is its own task. Promote when `next`
  ships a fixed stable — do the eslint bump and the overrides then, and drop
  `continue-on-error` in the same PR.
- **Every CI job installed cold, on every PR.** The workflow was `on: [pull_request]` only, so
  CI had *never once run on `master`* — the three caches that existed were all scoped to
  `refs/pull/N/merge`, and a cache written on a PR ref is readable only by that same PR. No
  `refs/heads/master` cache could ever exist, so all 8 jobs paid a full cold install and then
  raced to save a cache nobody would read (`Failed to save: … another job` in the logs).
  Fixed 2026-07-30 by adding `push: { branches: [master] }`, whose run seeds the base-branch
  cache all PRs restore from; `commitlint` is now `if: github.event_name == 'pull_request'`
  because `base.sha` is empty on a push event. Promote if PRs are still slow once a master
  run has landed: cache `node_modules` itself keyed on the `package-lock.json` hash, or
  collapse the five npm jobs into one install job that publishes `node_modules` as an
  artifact.
- **One job's `npm ci` stalls for minutes, unexplained.** Twice in a row (runs 30548167039 and
  30549456567) the `typecheck` job's `npm ci` took 6m / 8m+ while the four sibling jobs ran
  the identical command on the identical cold cache in 24–28s. In both cases npm printed its
  normal output up to the `git-raw-commits` deprecation warning (~13s in) and then went
  silent, i.e. it stalls during reify, after resolution — most likely a lifecycle script
  fetching a binary (`prisma` engines, `esbuild`, `sharp`). Not diagnosed. `timeout-minutes:
  15` is now on every job so a stall fails fast instead of burning a runner. Promote if it
  survives the base-branch cache fix; the next step is `npm ci --foreground-scripts
  --loglevel=verbose` in that job to name the hanging script.
- **Prisma Client must be generated explicitly in every CI job that typechecks or imports
  it.** `@prisma/client` hoists to the workspace root, its postinstall finds no
  `./prisma/schema.prisma` there (the schema lives in `backend/prisma/`), and it silently
  emits a stub client with zero models — which surfaces as `TS2305`/`TS2694` on every Prisma
  type. `typecheck`, `unit` and `acceptance` each run
  `npx prisma generate --schema backend/prisma/schema.prisma`; `backend/Dockerfile` already
  did. Promote to a root `postinstall` only if the Dockerfile `deps` stages are reworked —
  today they run `npm ci` with the schema not yet copied into the image, so a root
  postinstall would break `docker compose build`.
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
- **Public-read bucket policy for the `personas/` and `mascot/` prefixes.** F02's seed creates
  the bucket and PUTs all 15 objects, but they are not anonymously readable, so
  `/assets/mascot/*.webp` at the edge returns 403. Infra spec §7 owns this boundary
  (public-read on two prefixes, default-deny everywhere else). Promote when the first screen
  needs to actually render an avatar or the mascot — `ui`/`infra` scope, not a schema change.
- **`backend/tsconfig.json` missing.** `backend/package.json` declares
  `"build": "tsc -p tsconfig.json"` but no such file exists, so `npm run -w backend build`
  fails; the Dockerfile hides it with `|| true`. Predates F02 (F01 and F03 both added files
  under `backend/src` with the same gap). Promote before anything needs a compiled backend
  artefact — the `build` CI job currently only runs `docker compose build`.
- **`prisma.config.ts` migration.** The `package.json#prisma` seed entry that F02's task
  prescribes is deprecated in Prisma 6 (it warns on every CLI call) and removed in Prisma 7.
  Promote together with the Prisma 7 upgrade, which also swaps the `prisma-client-js`
  generator for `prisma-client` (ADR-F13).
