# Foundations — Decisions (append-only ADR log)

Never edit past entries. Supersede with a new dated entry referencing the one it changes.
Prefix `ADR-F` to avoid collision with other ledgers in this repo.
Referenced back into `PLAN.md`.

---

## ADR-F01 — 2026-07-30 — Error-code registry owned by F01, re-exported from @interviewly/types

**Context:** §4.5 mandates a single shared registry that both the API and the frontend
import. Options: (A) a standalone `packages/error-codes/` package, (B) a plain file in
`backend/src/lib/error-codes.ts` re-exported from `packages/types/`, (C) duplicated files
in `backend/` and `frontend/`.

**Decision:** Option B. The registry is authored once in `backend/src/lib/error-codes.ts`
as a `const` object of `{ [code: string]: { kind, http?, owner } }` and re-exported from
`packages/types/src/index.ts`. Feature ledgers append to `error-codes.ts` as they land.

**Why not A:** a dedicated package for ~40 string constants is over-engineered — it adds a
`package.json`, a build step, and a publish concern for a file any editor can navigate to
in two clicks.

**Why not C:** duplication allows the two copies to diverge; the frontend mapping the wrong
HTTP code to a locale string is a silent bug.

**Consequences:** `packages/types` must be built before any consumer runs `tsc`. The F01
task's verification command builds it. Feature ledgers that append to `error-codes.ts`
rebuild types as part of their own verification.

---

## ADR-F02 — 2026-07-30 — Full schema in one migration, structural changes locked to F02 scope

**Context:** Three feature teams work in parallel after day one. Each needs its own tables.
Naive parallel schema work produces timestamped migration folders that collide and a broken
`prisma migrate deploy` on a fresh clone — §10's one unacceptable failure (§5.2).

**Decision:** The complete `schema.prisma` (all 15 tables K13 names, plus enums, indexes,
and the soft-delete repo helpers) lands in F02 in a single initial migration. After merge,
feature ledgers may add indexes and nullable columns only, each in its own migration,
rebased before merge. Any structural change (new table, dropped column, changed relation,
new enum value) is discussed, not merged.

**Why not per-feature schema slices:** The migration ordering is part of the schema
contract. A feature branch that adds `reports` before `interviews` exists is structurally
broken. A single authoritative initial migration sidesteps the entire ordering problem.

**Consequences:** F02 has the highest blast radius of the three foundations tasks — a
column name chosen wrong here costs every downstream module a rename migration. F02 is
therefore assigned to `claude-opus-4.8` (MODELS.md). Structural changes after F02 are
change-controlled via DECISIONS.md, not freely merged.

---

## ADR-F03 — 2026-07-30 — Build context is the repo root for every service image

**Context:** npm workspaces put shared packages (`@interviewly/types`, `@interviewly/ai`)
at the repo root. A Docker build context scoped to `./frontend` or `./backend` cannot see
a sibling package — `COPY packages/ .` fails because the source is outside the context.

**Decision:** Every Dockerfile lives in its service directory (`frontend/Dockerfile`,
`backend/Dockerfile`, `worker/Dockerfile`) but is invoked with `context: .` at the repo
root in `compose.yaml`. The `.dockerignore` at the root excludes `node_modules`, `.git`,
`.next`, `.agents`, `*.md`, and other non-build artefacts.

**Why not symlinks or path-mapped contexts:** Compose `context` is the cleanest, officially
supported mechanism; symlinks behave differently across Docker Desktop versions.

**Consequences:** Every image build copies the full workspace root into the Docker build
context. The `.dockerignore` must be maintained to keep the context small; F03's task
Steps include an explicit `.dockerignore` entry list. IDEA.md §10.1 records this decision
for posterity.

---

## ADR-F04 — 2026-07-30 — No compose.override.yaml; dev extras in compose.dev.yaml

**Context:** Docker Compose auto-loads `compose.override.yaml` when present. Placing
developer-only port mappings there would silently expose `db`, `cache`, and `bucket` to
localhost on every `docker compose up`, breaking K14's "only `edge` publishes a port" claim
and creating a discrepancy between the scored demo and a dev machine.

**Decision:** `compose.override.yaml` is git-ignored and carries no behaviour. Developer
extras (host port publishing, hot reload, `tunnel`) live in `compose.dev.yaml`, loaded
explicitly with `-f compose.dev.yaml`. The default `compose.yaml` never exposes a service
port except `edge:80`.

**Why not always-explicit profiles for dev services:** Profiles gate optional services
(`observability`, `dev`/tunnel) but do not control port publishing; a profile cannot make
`db` publishable in dev without being committed. The explicit `-f` approach is explicit and
safe.

**Consequences:** `SETUP.md` must document the two invocations: bare `docker compose up`
(scored path) and `docker compose -f compose.yaml -f compose.dev.yaml up` (dev path).
This is recorded here so future maintainers understand why there is no `override`.

---

## ADR-F05 — 2026-07-30 — next-intl with cookie-based locale, no URL segment

**Context:** §4.5 says "locale in a cookie". Next-intl supports both URL-segment routing
(e.g. `/en/dashboard`, `/tr/dashboard`) and cookie/header-based detection with a single
path shape.

**Decision:** Cookie-based locale with `NEXT_PUBLIC_DEFAULT_LOCALE=en`. Routes stay as
`/dashboard` (no locale prefix). The `next-intl` middleware reads the cookie, falls back to
the `Accept-Language` header, then to the default. Turkish is selectable via a UI toggle
that writes the cookie.

**Why not URL-segment routing:** §4.5 is explicit about a cookie. URL segments would
require Next.js `[locale]/` directory nesting across all routes, double the route file
count, and generate locale-prefixed API calls that the backend does not understand.

**Consequences:** SEO for locale variants is weaker (no `/tr/` URLs), which is acceptable
for a demo evaluated by a technical panel. The `middleware.ts` must be configured to match
all non-API, non-asset routes.

---

## ADR-F06 — 2026-07-30 — Shadow database created by db/init.sql (F03), not by Prisma itself

**Context:** Prisma Migrate requires a `SHADOW_DATABASE_URL` for schema diffing. Options:
(A) a separate cloud DB, (B) Prisma auto-creates it (requires elevated Postgres privileges),
(C) repo-committed `db/init.sql` run by the Postgres container's init script.

**Decision:** Option C. `db/init.sql` creates both `interviewly` and `interviewly_shadow`
using `\gexec` pattern, run idempotently at container start. The `compose.yaml` mounts it
at `/docker-entrypoint-initdb.d/init.sql`. `SHADOW_DATABASE_URL` in `.env.example` points
at `db:5432/interviewly_shadow`.

**Why not A:** adds an external dependency to a dev-only need; breaks air-gapped or
offline dev.

**Why not B:** requires `CREATEDB` privilege on the Postgres user, which is a wider
permission than the application needs and a security concern at deploy time.

**Consequences:** F03 owns `db/init.sql`; F02's migration setup assumes it exists. The
`SHADOW_DATABASE_URL` env key must be present in every environment that runs
`prisma migrate dev`.

---

## ADR-F07 — 2026-07-30 — Logger is pino, identical factory in backend and worker

**Context:** K6 mandates a logger with a SCREAMING_SNAKE event name as the second
argument, both `traceId` and `interviewId` on interview-scoped lines, and no free-form
sentences. Options: (A) Winston, (B) pino, (C) a custom class.

**Decision:** Pino. `backend/src/lib/logger.ts` and `worker/src/lib/logger.ts` export the
same `pino({ level, transport })` instance. The `LOG_TRANSPORT=elastic` path uses
`pino-elasticsearch`; stdout is the default. No custom wrapper class.

**Why not Winston:** pino is ~5× faster (not critical here), but its structured-first API
(`logger.info(obj, msg)` ordering) is K6's exact contract without adaptation. Winston
defaults to `logger.info(msg, obj)` and needs a custom formatter for K6 compliance.

**Why not a custom class:** the K6 contract is pino's native API shape; wrapping it adds
indirection for zero gain.

**Consequences:** `pino` and (optionally) `pino-elasticsearch` are added as
`backend/package.json` and `worker/package.json` dependencies. The contract comment in
each file is the team's reminder that the event-name second argument is mandatory.

---

## ADR-F08 — 2026-07-30 — Env validation via Zod at startup, single typed config object

**Context:** §9.3 mandates fail-fast validation with the offending key named. Options:
(A) `dotenv-safe` (allowlist check only), (B) Zod schema + `safeParse` at module load,
(C) runtime checks scattered across modules.

**Decision:** Option B. `backend/src/lib/env.ts` runs a Zod `safeParse` on `process.env`
at import time. On failure it logs the bad key names and calls `process.exit(1)`. The
exported `config` object is the only way to read env vars; `process.env.X` reads outside
it are a defect caught in review. `worker/src/lib/env.ts` mirrors the pattern for the
worker's key subset.

**Why not dotenv-safe:** it only checks presence, not type coercion or value ranges
(e.g. `SESSION_SECRET` must be ≥ 32 chars, `MAX_INTERVIEWS_PER_USER_PER_DAY` must be a
positive integer). Zod expresses all of these in one place.

**Why not C:** scattered checks produce partial startup — one module may boot and serve
requests while another fails, creating inconsistent behaviour. A single upfront check
either works or doesn't.

**Consequences:** `zod` is a runtime dependency of `backend` and `worker`. The schema is
the documentation of every env key; a key not in the schema cannot be used in application
code by construction (TypeScript narrows the type).

---

## ADR-F09 — 2026-07-30 — `mail` (Mailpit) in the default Compose profile

**Context:** K8.6 adds email verification and password reset, and registration *always*
enqueues an `email.send` job. Options for where the SMTP sink lives: (A) `dev` profile,
(B) default profile, (C) no sink — swallow the job when SMTP is unset.

**Decision:** Option B. `mail` (Mailpit) runs in the **default** profile with a healthcheck;
`worker` depends on it `service_healthy`. Its web inbox port is published only in
`compose.dev.yaml`, so "only `edge` publishes a port in `compose.yaml`" stays true (K14).

**Why not A:** a bare `docker compose up` — the thing §10 says must work — would then
dead-letter a job on the first signup. A stack that "works" while failing a queue job on the
most common action is worse than one that visibly needs a flag.

**Why not C:** a silently swallowed send makes a broken mailer indistinguishable from a
working one, and the retry/dead-letter machinery (K10) is exactly what tells us which it is.

**Consequences:** ~20 MB and one more container in the default up. `SETUP.md` names the inbox
URL and states that an evaluator never needs it, because `EMAIL_VERIFICATION_REQUIRED` ships
`false` and seeded accounts are pre-verified.

---

## ADR-F10 — 2026-07-30 — Outfit replaces Fraunces for headings; Inter stays for body

**Context:** §4.2 originally set headings in the Fraunces serif. The reviewed visual direction
is a **bold geometric sans set large**, and both references (Cambly, Jotform) are geometric
sans throughout — the serif was carrying "warm" alone, against the grain of everything else on
the screen. Options: (A) keep Fraunces, (B) one geometric sans for headings *and* body,
(C) Outfit headings + Inter body.

**Decision:** Option C. Outfit (500/600/700) for headings, Inter (400/500/600) for body and UI,
both `next/font/google` with `display: swap`.

**Why not B:** the direction said "body in the same family", but Outfit at the 13–14 px steps of
the type scale reads measurably worse than Inter, and two of the six scale steps are body sizes.

**Why not A:** it fights the rest of the system, and the reversal is cheaper now than after
screens exist.

**Consequences:** one extra `next/font` call, still zero external font requests (CSP + LCP
unaffected). F01's verification greps the repo for `fraunces` and must find nothing.

---

## ADR-F11 — 2026-07-30 — The entry gradient is a token plus a closed route list

**Context:** §4.2 adds a pastel lavender→cream→peach ground for entry surfaces. Options:
(A) per-screen background styles, (B) a `--gradient-entry` token applied wherever a screen
wants it, (C) the token **plus** an enumerated list of routes it grounds (`ui` Behaviour 5a).

**Decision:** Option C, with the room, report, dashboard and admin explicitly on flat `--bg`.

**Why not A/B:** "apply where it feels right" drifts within a week and cannot be reviewed. An
enumerated list makes a gradient on the wrong route a defect with a name, and it protects the two
surfaces where the gradient actively hurts — a live face and a data table.

**Consequences:** `tokens.css` carries the three stops and the composed gradient; the AA-contrast
check gains six pairs (text and muted-text against each stop individually, since text sits over
all three as the page scrolls).

---

## ADR-F12 — 2026-07-30 — Local pre-commit enforcement via husky + lint-staged, staged-files-only

**Context:** CI is currently the only place `lint`/`typecheck` run — a broken commit surfaces
minutes later in a PR check, not at commit time. Options: (A) no local hook, keep CI as the
sole gate; (B) `husky` + `lint-staged`, staged-files-only; (C) a full-repo `pre-commit`
(Python tool, common outside the JS ecosystem) running the complete `lint`/`typecheck` suite on
every commit.

**Decision:** Option B. `husky` manages the git hook itself (`.husky/pre-commit` → `npx
lint-staged`); `lint-staged` scopes ESLint to the files actually staged, split by workspace:
`frontend/**` reuses its own existing `eslint-config-next` setup, `{backend,worker,packages/*}/**`
get one new root-level flat config (F04). `tsc --noEmit` is explicitly **not** run in the hook —
TypeScript project-wide typechecking on a file subset isn't meaningful, so that stays a
CI/manual gate (`npm run typecheck`).

**Why not A:** the whole point is catching a broken commit before it costs a CI round-trip;
"CI is the safety net, not the first run" (EXECUTE.md, Part 2) already states the intent, it
was just never wired locally.

**Why not C:** both `pre-commit` (the tool) and a full-repo lint on every commit are wrong for
this stack — `pre-commit` is a second package manager/dependency system (Python) for a repo
that's npm end to end, and a full-repo lint on every commit scales with repo size, not commit
size; it's the kind of hook people learn to `--no-verify` past within a week.

**Consequences:** `husky` and `lint-staged` become root `devDependencies`; a `"prepare": "husky"`
script runs on every `npm install`, including in CI/Docker build contexts, so it must no-op
safely with no `.git` directory present (husky v9's generated hook already guards this — F04
verifies it rather than reimplementing it). `backend/`, `worker/`, and `packages/*/` get their
first-ever ESLint config as a direct consequence — F04 folds in the pre-existing "root
`eslint.config.js` missing" backlog gap rather than leaving it to a third task, since a hook
can't lint a command that doesn't run.
