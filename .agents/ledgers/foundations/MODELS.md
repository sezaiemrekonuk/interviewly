# Foundations — Recommended Model Per Task

F02 has the highest blast radius — a column name wrong here costs every downstream module
a rename migration. F01 and F03 are scaffolding tasks with low divergence risk. Haiku,
mini, and flash models are banned for this repo.

| ID | Title | Model | Why |
|----|-------|-------|-----|
| F01 | Creating design tokens, next-intl scaffold, error-code registry, and @interviewly/types | `claude-sonnet-4.6` | Token/i18n scaffold is deterministic from the spec table; moderate reasoning sufficient. |
| F02 | Creating full Prisma schema, migrations, seed, and soft-delete repo helpers | `claude-opus-4.8` | Schema is the highest-blast-radius artefact in the project; every downstream task binds to its column names, types, and constraints. Get it right once. |
| F03 | Creating npm workspaces root, compose.yaml, Caddyfile, logger, env schema, and CI workflow | `claude-sonnet-4.6` | Pure config authoring; the spec is prescriptive and the output is easily validated with `docker compose config` + `npm run build`. |
| F04 | Local pre-commit hooks (husky + lint-staged) for backend, frontend, packages | `claude-sonnet-4.6` | Tooling wiring over a prescriptive task spec; verified by triggering the hook and checking exit codes — same risk profile as F01/F03. |

## Summary

- **`claude-opus-4.8` (1 task):** F02 — schema authoring, highest blast radius.
- **`claude-sonnet-4.6` (3 tasks):** F01, F03, F04 — scaffolding/tooling, deterministic from spec.

Rule of thumb for this repo: **schema + data model = expensive; tokens + config + CI =
sonnet-class.** When unsure on a sonnet-class task, run it and do a code review on the
diff — cheaper than running it expensive.
