# Project conventions

Interviewly — a mock interview application. See `.agents/docs/IDEA.md` for the full
design; it is the single reference document and every spec derives from it.

npm workspaces at the repo root, orchestrated by Docker Compose. Services:

| Path | Is |
|---|---|
| `frontend/` | Next.js app (`web` container) |
| `backend/` | Express modular monolith (`api`) — `modules/auth`, `interview`, `admin`, `ai` |
| `worker/` | BullMQ consumer — report generation, voice reconciliation, sweeper |
| `edge/` | Caddyfile — single-origin reverse proxy, the only published port |
| `db/` | Postgres init SQL (creates the Prisma shadow database) |
| `elasticsearch/`, `kibana/` | Config for the optional `observability` profile |
| `ci/` | CI helper scripts referenced by `.github/workflows/` |

There is no `ai-gateway` service. The AI layer is `modules/ai` in `backend/` plus the
`@interviewly/ai` workspace package, shared with `worker/` — see IDEA.md K1.1 for why the
separate container was rejected.

Build context for every image is the **repo root**, because workspace packages live there.

## Planning: ledger-driven development

This repo runs on ledger-driven development. A durable, on-disk ledger — not a chat
transcript — is the memory.

- Start new work with the `plan-initiative` skill. It interrogates the ask, records
  a decision table, and decomposes the work into numbered task files.
- Change existing work with the `update-initiative` skill. It appends; it never
  rewrites history.

Write initiative folders to `.agents/ledgers/<slug>/`, **not** `.<slug>/` at the
repo root as the skill's own default says.

The five rules:

- **The ledger is the memory.** Nothing important lives in a chat transcript.
- **One session = one task.** Read STATE → read one task file → verify → commit → stop.
- **IDs are permanent addresses.** Never renumbered, never reused.
- **Decisions are append-only.** A superseded ADR still explains why the code looks the way it does.
- **Verification is a command, not a wish.** No task is done because it looks done.

## Where things live

| Path | Holds |
|---|---|
| `.agents/EXECUTE.md` | How the team claims, runs, verifies and merges a ledger task. Read before your first task. |
| `.agents/prompts/` | `AUTHOR_DOCS.md` — the three-stage prompt from IDEA.md to specs to features to ledgers. |
| `.agents/ledgers/` | Initiative folders — PLAN, DECISIONS, STATE, REFERENCE, MODELS, tasks. |
| `.agents/specs/` | Specs and designs. |
| `.agents/features/` | Gherkin `.feature` files — the acceptance-criteria source of truth. |
| `.agents/docs/` | `IDEA.md` (the design reference) and `USER_STORIES.md`. |
| `.agents/skills/` | Shared agent skills. Copilot CLI loads these automatically. See its README. |
| `.github/instructions/` | Always-on response and code-discipline rules. |

## Skills

Copilot CLI loads every skill in `.agents/skills/` at session start. `/skills` lists
them, `/skills reload` picks up changes without restarting. Beyond the two ledger
skills, the directory carries the superpowers set: systematic debugging,
test-driven development, code review, verification before completion, and more.
Use them — they are checked in so the whole team gets the same behavior.
