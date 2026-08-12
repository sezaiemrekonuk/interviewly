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

**`test:integration` no longer reads `.env` for its stores either.** It used to, and `.env`
names `db:5432/interviewly` — the application's own database — so the ring that creates users,
interviews and personas and cleans up almost none of it was pointed at production data by
default. The script now resolves both URLs itself, ahead of `--env-file-if-exists`, to
`interviewly_test` on `localhost:5432` and Redis db **1** on `localhost:6380` — the same
disposable targets and the same `TEST_DATABASE_URL` / `TEST_REDIS_URL` precedence
`test:acceptance` uses, and the same `assertDisposableStores` refusal
(`vitest.global-setup.mts`) if a non-disposable URL still arrives from a shell export. So bring
the stack up with `compose.dev.yaml` (below) and `npm run test:integration` works on a laptop;
the global setup runs `prisma migrate deploy` into the test database for you.

**`test:acceptance` does not read `.env` for its stores** (issues #170, #119). It runs against
`interviewly_test` on `localhost:5432` and Redis db **1** on `localhost:6380` — both published
by `compose.dev.yaml`, so bring the stack up with it (`docker compose -f compose.yaml -f
compose.dev.yaml up -d`) or the run cannot connect. Override by **exporting**
`TEST_DATABASE_URL` / `TEST_REDIS_URL` — they are read before `.env` is loaded, so putting them
in `.env` does nothing. An exported `DATABASE_URL` / `REDIS_URL` also still wins over the
default, which is how CI points the run at its own services.

**The Redis database index is not yours to pick.** Whatever URL wins, `cucumber.js` moves it to
db 1 if it resolves to db 0 — a pathless `redis://host:port` included, which is the shape nearly
every REDIS_URL here has. The suite FLUSHDBs what it connects to, so db 0 is never the answer.
`test:integration` does not rewrite: it refuses db 0 and tells you to spell an index out.

The suite then refuses to start against a database whose name does not end in `_test`/`ci`, or
against Redis db 0 — it TRUNCATEs and FLUSHDBs what it is given, and it used to be given the
application's stores. `ACCEPTANCE_ALLOW_DESTRUCTIVE_DB=1` opts out of all of it, out loud.

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
