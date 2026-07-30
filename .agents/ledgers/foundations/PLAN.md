# Foundations — PLAN (Architecture)

Written once. Amend only via a new `DECISIONS.md` ADR-F entry referenced here.
Codebase orientation: `REFERENCE.md` (read that before touching any task).

## Goal

Before feature work can begin, three parallel artefacts must land green on the same day:
shared design tokens and locale scaffold, the complete Prisma schema with repo helpers, and
the npm workspaces root with Compose + CI wiring. When all three are merged, any engineer
can clone the repo, run `docker compose up`, and reach a seeded, single-origin app — and
any subsequent feature ledger has a stable schema, a typed token palette, and a CI
pipeline to target.

## The invariant this initiative must not weaken

> A bare `docker compose up` on a clean clone must produce a working, seeded,
> single-origin app with no manual step (IDEA.md §10).

F03 authors the Compose file; F02 writes the schema that migration runs; F01 writes the
tokens and error codes that every module imports. None of the three tasks may ship a
broken `compose.yaml`, an incomplete schema, or missing registry entries. Verification
for all three is infra-level (migrate, compose config, build), not feature-test-level —
this is correct and expected (COVERAGE.md db/infra out-of-ring note).

## Topology

```
.agents/ledgers/foundations/    ← this ledger
  tasks/F01-*  F02-*  F03-*

Repo root (post-foundations):
  package.json                  ← npm workspaces (F03)
  compose.yaml                  ← service inventory (F03)
  compose.dev.yaml              ← dev overrides (F03)
  Caddyfile                     ← edge routes (F03)
  .env.example                  ← validated env schema (F03)
  .github/workflows/ci.yml      ← CI pipeline (F03)

  packages/
    types/                      ← @interviewly/types shared TS (F01)
    ai/                         ← @interviewly/ai workspace (F03 wires; ai ledger fills)

  frontend/
    styles/tokens.css           ← CSS custom properties :root block (F01)
    messages/en.json            ← English locale strings (F01)
    messages/tr.json            ← Turkish locale strings (F01)
    src/i18n.ts                 ← next-intl config (F01)
    src/i18n/request.ts         ← next-intl request config (F01)
    src/middleware.ts            ← next-intl locale middleware (F01)

  backend/
    prisma/
      schema.prisma             ← complete schema, ALL tables (F02)
      migrations/               ← timestamped Prisma migrations (F02)
      seed.ts                   ← demo data, personas, clusters (F02)
    src/lib/
      error-codes.ts            ← shared error-code registry (F01)
      logger.ts                 ← pino logger factory (F03)
      env.ts                    ← Zod env schema (F03)

  db/
    init.sql                    ← shadow database creation (F03)
```

No cross-service calls exist yet — foundations is pure scaffolding.

## Task → IDEA.md §5.2 F-label mapping

| Task ID | IDEA.md label | Contents |
|---------|---------------|----------|
| F01 | F-a | Design tokens, `next-intl` scaffold, error-code registry, shared TS types package |
| F02 | F-b | `schema.prisma` in full, Prisma Migrate setup, `prisma/seed.ts`, repo helpers |
| F03 | F-c | npm workspaces root, `compose.yaml` + Caddyfile skeleton, logger contract, env schema + `.env.example`, CI workflow |

## Decision table (full ADRs in DECISIONS.md)

| ADR | Decision | Chosen | Reason |
|-----|----------|--------|--------|
| ADR-F01 | Where does the error-code registry live? | `backend/src/lib/error-codes.ts`, re-exported via `@interviewly/types` | Both API and frontend need stable codes (§4.5); single source prevents divergence. |
| ADR-F02 | Entire schema in F02, structural changes locked | All 14 tables in one initial migration; feature ledgers add indexes/nullable cols only | §5.2 migration protocol: parallel structural changes break `docker compose up` on a fresh clone. |
| ADR-F03 | Build context for every service image | Repo root (`context: .`) with per-service `dockerfile:` path | npm workspaces put `@interviewly/types` and `@interviewly/ai` at root; a service-scoped context cannot see them. |
| ADR-F04 | Dev extras in compose.dev.yaml, not compose.override.yaml | `compose.override.yaml` is git-ignored; dev config in explicit `-f compose.dev.yaml` | Compose auto-loads `override.yaml`, which would silently publish `db`/`cache` ports and break K14. |
| ADR-F05 | next-intl locale routing | Cookie-based, no URL segment prefix | §4.5 mandates a cookie; URL segments would require `[locale]/` nesting across all routes. |
| ADR-F06 | Shadow database creation | `db/init.sql` mounts into Postgres init dir | Auto-create requires elevated privileges; external URL adds an unwanted dependency. |
| ADR-F07 | Logger factory | Pino, identical in `backend/` and `worker/`; `logger.<level>(obj, "EVENT")` shape | K6's structured-first API is pino's native shape; Winston needs adaptation. |
| ADR-F08 | Env validation | Zod `safeParse` at module load, `process.exit(1)` on failure, typed `config` export | §9.3: fail-fast, key named in message. No scattered `process.env` reads in application code. |

## Data model additions

Migration `0001_init` — created by F02. DDL creates all 14 tables plus enums in a single
`prisma migrate dev --name init` run. The shadow database (`SHADOW_DATABASE_URL`) is
assumed to exist (created by F03's `db/init.sql`). No further structural migration is
authored in this ledger. See `tasks/F02-*.md` for the complete table/column list.

## Phasing / task clusters (see STATE.md ledger)

0. Day-zero parallel (F01, F02, F03) — all three start the same day, all independent.
1. All three green → feature ledgers may start.

## Out of scope (post-foundations)

- Feature endpoints, business logic, state machine, UI screens, report generation — every
  feature ledger.
- The `@interviewly/ai` workspace package's implementation — `ai` ledger fills it; F03 only
  wires the package.json entry so `backend` and `worker` can see a sibling package.
- Adaptive question flow (K4), voice room, avatar drivers — `voice` and `adaptive` ledgers.
- PDF export, nightly sweeper, voice reconciliation worker jobs — `report` and `voice`
  ledgers.
- Additional indexes and nullable columns for features — each feature ledger adds its own
  migration, rebased before merge.

**Schema collision rule (verbatim — must appear in every ledger's Out of scope):**
Feature ledgers may add indexes and nullable columns only, each in its own migration,
rebased before merge. Any structural change is a change to F02's scope and gets discussed,
not merged. This is the week-one collision that breaks `docker compose up` on a fresh
clone, which §10 calls the one unacceptable failure.
