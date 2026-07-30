# Foundations — State

Last updated: 2026-07-30
Last session ended: **F03 done.** Workspace root, compose files (default/dev/observability),
Caddyfile, `.env.example`, backend+worker logger/env, CI workflow, Dockerfile skeletons all
landed. `docker compose config` exits 0; `grep -n "ports:" compose.yaml` shows exactly one
match (`edge`); `grep -c "service_completed_successfully" compose.yaml` = 2. F01 and F02 are
now both eligible and can run in parallel.

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

**F03 is done.** F01 (Ahmet) and F02 (Fatih) are both now eligible and genuinely parallel —
their dependency on F03 is satisfied. Apply `.agents/EXECUTE.md` Part 1 § 4 to confirm.

## Environment

Nothing is installed yet. Each task's `## Steps` lists the exact commands to set up its
own scope. A fresh clone needs only `node` ≥ 22 and Docker Desktop installed. The
`compose.yaml` does not exist until F03 lands; F01 and F02 can be verified without it
(see their individual `## Verification` commands).

## Open blockers / decisions for the user

None at ledger-write time. The two open questions in the `ui` spec (styling layer choice,
optional second `speaking` avatar) are decided or deferred in ADR-F01 and F01's task
steps. The `voice` CSP open question does not block foundations.

## Task ledger (F01–F03)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| F01 | Creating design tokens, next-intl scaffold, error-code registry, and @interviewly/types package | | todo | F03 |
| F02 | Creating full Prisma schema, migrations, seed, and soft-delete repo helpers | | todo | F03 |
| F03 | Creating npm workspaces root, compose.yaml, Caddyfile, logger, env schema, and CI workflow | | done | — |

## Critical path

**F03 → {F01, F02} in parallel** → all three green → every feature ledger (auth,
interview-core, report, admin, voice, adaptive) may start.

The earlier "three tasks, three people, no cross-dependency, day one" reading was wrong:
F01 and F02 cannot run their own verification commands until F03 exists, and rule 5 is that
verification is a command, not a wish.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **`@interviewly/ai` package implementation** — F03 wires the `packages/ai/` entry in
  `package.json`; the package body is empty until the `ai` ledger claims it. Promote when
  the ai ledger is authored.
- **`compose.dev.yaml` hot-reload mounts** — F03 creates the file with the `tunnel`
  service; bind-mount configuration for hot reload can be added without a structural
  change. Promote when a developer reports a DX pain point.
- **Elasticsearch / Kibana Compose wiring** — `observability` profile services; F03 creates
  the skeleton. Full index-template and dashboard config deferred to a parallel
  observability task outside MVP scope.
