# Foundations — State

Last updated: 2026-07-30
Last session ended: **—** Ledger written; no task has started yet.

## Execution protocol (follow exactly)

Read this file → read `REFERENCE.md` once → read only the current task's file →
check `MODELS.md` for the recommended model → do the work, ticking checkboxes →
run the task's `## Verification` command verbatim → fill in the task's `## Notes` →
update this file's ledger row, "Current task" pointer, and "Last session ended" line →
write `.agents/devlogs/{ID}-<slug>.md` (EXECUTE.md § Devlog) →
commit as `{ID}: <title>` → **STOP. Do not roll into the next task.**

## Current task

**F01, F02, and F03 are all `todo` and independent — start any one.**
Three people may work them in parallel on day one (IDEA.md §5.2). Assign yourself one,
mark it `in_progress` here, and work only that task in your session.

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
| F01 | Creating design tokens, next-intl scaffold, error-code registry, and @interviewly/types package | | todo | — |
| F02 | Creating full Prisma schema, migrations, seed, and soft-delete repo helpers | | todo | — |
| F03 | Creating npm workspaces root, compose.yaml, Caddyfile, logger, env schema, and CI workflow | | todo | — |

## Critical path

F01 + F02 + F03 in parallel → all three green → every feature ledger (auth, interview-core,
report, admin, voice, adaptive) may start.

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
