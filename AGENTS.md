# Interviewly

AI mock interviews. Paste a job listing → the role is classified and questions are written from
it → an HR persona (**Ada**) takes a round, then a technical persona (**Turing**) → you answer by
voice or by typing → every answer is scored and a report lands with per-question scores, written
reasons and the transcript. EN and TR at full parity.

Monorepo, npm workspaces: `frontend` (Next.js App Router) · `backend` (Express + Prisma/Postgres)
· `worker` (BullMQ jobs) · `packages/{types,ai}` · `edge` (Caddy).

Per-area files: [frontend/AGENTS.md](frontend/AGENTS.md) · [backend/AGENTS.md](backend/AGENTS.md).
This file holds only what the repo cannot tell you itself.

---

## Running it

Everything runs in Docker Compose, behind `edge` on **port 80**. Not on the service ports —
`localhost:3000` is not the app.

```
docker compose up -d              # whole stack
docker compose up -d --build web  # REQUIRED to see frontend changes in a browser
```

**The `web` container is a production build.** Editing a file changes nothing in the browser
until you rebuild it. Rebuilding takes a couple of minutes; budget for it before you promise a
visual check. Same for `api` and `worker`.

Seeded demo account: `admin@demo.com` / `AdminDemo1!` — an admin with one completed interview
(with a report) and one paused. Mailpit at `:8025` is where verification and reset links arrive.

## Testing

```
npm test                 # the default vitest projects, all workspaces
npm run typecheck
npm run lint
```

**Always go through the npm script.** A bare `npx vitest` fails: `backend/src/env.ts` calls
`process.exit(1)` when required vars are missing, and the root script supplies them with
`--env-file-if-exists=.env`.

**`test:integration` and `test:acceptance` cannot run on the host.** `.env` points at
`db:5432` and `cache:6379`, which only resolve inside the compose network; on a laptop they hang
on `getaddrinfo ENOTFOUND cache`. Export host-reachable `DATABASE_URL` / `REDIS_URL` first — a
shell export beats `--env-file` — or run them in the container. This is not a broken setup, and
"fixing" `.env` breaks compose.

## Task ownership — read before you write code

`.agents/` holds per-area ledgers (`PLAN.md`, `STATE.md`, `DECISIONS.md`, `tasks/`) split across
**three people**. `.agents/EXECUTE.md` §1 is the only authority on who owns what, and task-ID
prefixes say it too: `F` foundations · `A` auth · `I` interview-core · `R` report · `N` admin ·
`V` voice · `D` adaptive · `W` frontend · `S` speech.

Never start a task the table does not assign to the person who invoked you. Two people editing
`schema.prisma` is the expensive version of guessing.

**`S` supersedes `V`.** ElevenLabs is voice *generation* only now — no agent, no webhooks. `V01`–
`V05` stay `done` and are not reopened; new work goes in the `S` ledger (ADR-S01).

## Commits

Conventional Commits, enforced by commitlint via husky. lint-staged runs eslint on staged files
with two different configs — `frontend/eslint.config.mjs` for `frontend/**`, the root
`eslint.config.js` for everything else.

## Things that are true and look like bugs

- **`answers.scores` is usually `null`.** `promoteNextQuestion` (`backend/modules/interview/
  adaptive.ts`) returns early when a question has no pre-generated candidates, which is every
  interview today. The reliable per-question grade is `report_questions`. Do not build a feature
  on the four-axis breakdown without checking it exists.
- **`ended_reason='cut_short'` is never written**, so `/admin/stats.cutShort` is always 0. The
  admin copy says so out loud.
- **Deletion is soft everywhere** and every FK is `ON DELETE RESTRICT`. A hard delete will fail.
- `/test/*` routes mount only under `NODE_ENV=test`.
