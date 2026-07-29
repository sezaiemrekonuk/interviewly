# Project conventions

Multi-service application: `backend/`, `frontend/`, `db/`, `elasticsearch/`,
`kibana/`, `messagequeue/`, `redis/`, orchestrated by Docker at the repo root.

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
| `.agents/ledgers/` | Initiative folders — PLAN, DECISIONS, STATE, REFERENCE, MODELS, tasks. |
| `.agents/specs/` | Specs and designs. |
| `.agents/features/` | Feature notes. |
| `.agents/docs/` | Agent-facing documentation. |
| `.agents/skills/` | Shared agent skills. Copilot CLI loads these automatically. See its README. |
| `.github/instructions/` | Always-on response and code-discipline rules. |

## Skills

Copilot CLI loads every skill in `.agents/skills/` at session start. `/skills` lists
them, `/skills reload` picks up changes without restarting. Beyond the two ledger
skills, the directory carries the superpowers set: systematic debugging,
test-driven development, code review, verification before completion, and more.
Use them — they are checked in so the whole team gets the same behavior.
