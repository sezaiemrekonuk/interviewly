# F03 — Creating npm workspaces root, compose.yaml, Caddyfile, logger, env schema, and CI workflow
REPO: (this repo) · Depends: — · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — pure config authoring; the spec is prescriptive and the output is validated with `docker compose config` + `npm run build`.

## Goal
Owner's ask:

> "npm workspaces root, `compose.yaml` + Caddyfile skeleton, logger contract (K6),
> env schema + `.env.example`, CI workflow. Pure config; lands fastest."
> — IDEA.md §5.2 F-c

This task wires the repository as a proper npm workspace, defines the container topology
so `docker compose up` boots a working stack, establishes the logger contract every service
uses (K6), defines the env schema with fail-fast startup validation (§9.3), and creates
the CI pipeline (§11.4). It touches no Prisma schema, no token file, no locale file —
F01 and F02 are fully independent.

## Non-negotiables
- **Only `edge` publishes a host port in `compose.yaml`.** `db`, `cache`, `bucket`, `api`,
  `worker`, `web` must have no `ports:` in the committed `compose.yaml` (K14, ADR-F04).
- **`compose.override.yaml` is git-ignored.** It must appear in `.gitignore`; if it
  existed before this task it must stay ignored — developer-only config belongs in
  `compose.dev.yaml` (ADR-F04).
- **Migrations run as a one-shot `migrate` service, never in the `api` entrypoint.**
  The `migrate` service exits 0 and `api`/`worker` depend on it via
  `service_completed_successfully` (§10.3).
- **Every service in the default profile has a `healthcheck`.** `depends_on: { condition:
  service_healthy }` must be used, not `service_started` (§10.3).
- **No secret committed.** `.env.example` uses placeholder values only. Session secrets
  are fake strings. API keys are empty strings.
- **Build context is the repo root for every built service** (ADR-F03).
- **The logger contract is pino, identical in `backend/` and `worker/`** (K6).
- **Env validation fails fast.** The Zod check in `backend/src/lib/env.ts` (and mirrored
  in `worker/`) must exit the process non-zero with the bad key named if any required
  variable is missing or malformed (§9.3).

## Context (anchors)
- `package.json` (root) — the npm workspaces root. `workspaces: ["packages/*", "frontend",
  "backend", "worker"]`. If F01 created this file, extend it; do not overwrite.
- `compose.yaml` — the service inventory. 8 default-profile services plus the one-shot
  `migrate` service (§10.1). See Steps for the full service list and rules.
- `compose.dev.yaml` — developer extras: `tunnel` service (cloudflared), host port
  publishing for `db`/`cache`/`bucket`/`api`, hot-reload bind mounts. Referenced in
  `SETUP.md` with `-f compose.dev.yaml`.
- `Caddyfile` — route table: `/api/*` → `api:4000`, `/assets/*` → `bucket:9000` (public
  prefix), `/events/*` → `api:4000`, `/webhooks/*` → `api:4000`, `/*` → `web:3000`.
  Self-signed TLS is handled automatically by Caddy for `localhost`.
- `db/init.sql` — creates the `interviewly` database and `interviewly_shadow` database
  if they don't exist. Used by the Postgres init script mount in `compose.yaml`.
- `backend/src/lib/logger.ts` — pino logger factory. Exported as a named `logger`
  instance. Used by `backend/` and imported (or duplicated) in `worker/`. See Steps for
  the exact shape.
- `backend/src/lib/env.ts` — Zod env schema for the full §9.3 env table. Exported as
  `config` (the typed, validated config object). Any `process.env` read outside this
  object is a defect.
- `worker/src/lib/logger.ts` — same pino factory as backend (duplicated or imported via
  `@interviewly/types` if the types package exposes it — keep it simple, duplicate is fine).
- `worker/src/lib/env.ts` — worker's env schema, a subset of backend's schema covering
  the keys the worker uses.
- `.env.example` — every key from §9.3 with a safe placeholder and one comment per
  variable. This file is committed.
- `.gitignore` — must include `.env`, `compose.override.yaml`.
- `.github/workflows/ci.yml` — CI pipeline (§11.4). See Steps for the full job list.
- `packages/ai/package.json` — empty workspace stub (`@interviewly/ai`, `"main":
  "src/index.ts"`) so `backend` and `worker` can list it as a dependency and the
  workspace is resolvable. The package body is empty until the `ai` ledger lands.

  **The trap:** `compose.yaml` must list `depends_on` for `api` and `worker` that
  includes `migrate: { condition: service_completed_successfully }`. If you use
  `service_healthy` for `migrate`, Compose will error because a one-shot service never
  becomes healthy. Use `service_completed_successfully` for `migrate` and
  `service_healthy` for long-running services.

## Steps
- [ ] **1. Write or extend root `package.json`**
  ```json
  {
    "name": "interviewly",
    "private": true,
    "workspaces": ["packages/*", "frontend", "backend", "worker"],
    "scripts": {
      "build": "npm run -w @interviewly/types build && npm run -w frontend build && npm run -w backend build",
      "typecheck": "tsc --noEmit -p tsconfig.json",
      "lint": "eslint . --ext .ts,.tsx",
      "test:acceptance": "npm run -w backend test:acceptance",
      "seed": "npm run -w backend seed"
    },
    "devDependencies": {
      "typescript": "^5",
      "eslint": "^9",
      "@typescript-eslint/eslint-plugin": "^8",
      "@commitlint/cli": "^19",
      "@commitlint/config-conventional": "^19"
    }
  }
  ```
  Add `commitlint.config.js` at root:
  ```js
  module.exports = { extends: ['@commitlint/config-conventional'] };
  ```

- [ ] **2. Create `db/init.sql`**
  ```sql
  -- Creates application DB and shadow DB for Prisma Migrate.
  SELECT 'CREATE DATABASE interviewly'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'interviewly')\gexec
  SELECT 'CREATE DATABASE interviewly_shadow'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'interviewly_shadow')\gexec
  ```

- [ ] **3. Write `compose.yaml`**

  Full service inventory. Key rules:
  - All images: pin to minor version tags (never `latest`).
  - Build context: `.` (repo root) for every built service; `dockerfile:` names the
    service dir path.
  - `edge` only: `ports: ["80:80"]`.
  - `migrate` service: `command: ["npx", "prisma", "migrate", "deploy"]`,
    `depends_on: { db: { condition: service_healthy } }`, no healthcheck (it's a job).

  ```yaml
  name: interviewly
  services:
    db:
      image: postgres:16-alpine
      environment:
        POSTGRES_USER: interviewly
        POSTGRES_PASSWORD: interviewly
        POSTGRES_DB: interviewly
      volumes:
        - pgdata:/var/lib/postgresql/data
        - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U interviewly"]
        interval: 5s
        timeout: 5s
        retries: 10

    cache:
      image: redis:7-alpine
      volumes:
        - redisdata:/data
      healthcheck:
        test: ["CMD", "redis-cli", "ping"]
        interval: 5s
        timeout: 5s
        retries: 10

    bucket:
      image: minio/minio:RELEASE.2024-11-07T00-52-20Z
      command: server /data
      environment:
        MINIO_ROOT_USER: minioadmin
        MINIO_ROOT_PASSWORD: minioadmin
      volumes:
        - miniodata:/data
      healthcheck:
        test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/ready"]
        interval: 10s
        timeout: 5s
        retries: 10

    migrate:
      build:
        context: .
        dockerfile: backend/Dockerfile
      command: ["npx", "prisma", "migrate", "deploy"]
      env_file: [.env]
      depends_on:
        db:
          condition: service_healthy

    api:
      build:
        context: .
        dockerfile: backend/Dockerfile
      env_file: [.env]
      depends_on:
        db:
          condition: service_healthy
        cache:
          condition: service_healthy
        bucket:
          condition: service_healthy
        migrate:
          condition: service_completed_successfully
      healthcheck:
        test: ["CMD", "curl", "-f", "http://localhost:4000/healthz"]
        interval: 10s
        timeout: 5s
        retries: 10

    worker:
      build:
        context: .
        dockerfile: worker/Dockerfile
      env_file: [.env]
      depends_on:
        db:
          condition: service_healthy
        cache:
          condition: service_healthy
        bucket:
          condition: service_healthy
        migrate:
          condition: service_completed_successfully

    web:
      build:
        context: .
        dockerfile: frontend/Dockerfile
      env_file: [.env]
      healthcheck:
        test: ["CMD", "curl", "-f", "http://localhost:3000"]
        interval: 10s
        timeout: 5s
        retries: 10

    edge:
      image: caddy:2-alpine
      ports:
        - "80:80"
      volumes:
        - ./Caddyfile:/etc/caddy/Caddyfile:ro
      depends_on:
        web:
          condition: service_healthy
        api:
          condition: service_healthy

  volumes:
    pgdata:
    redisdata:
    miniodata:

  # Profile-gated services in compose.dev.yaml and compose.observability.yaml
  ```

  **Note:** `elasticsearch` and `kibana` go into a separate `compose.observability.yaml`
  loaded with `--profile observability` (or explicitly with `-f compose.observability.yaml`).
  Create a minimal skeleton for those in `compose.observability.yaml`.

- [ ] **4. Write `compose.dev.yaml`**
  Developer extras — host port publishing, tunnel. This file is loaded explicitly with
  `-f compose.dev.yaml`:
  ```yaml
  name: interviewly
  services:
    db:
      ports: ["5432:5432"]
    cache:
      ports: ["6379:6379"]
    bucket:
      ports: ["9000:9000"]
    api:
      ports: ["4000:4000"]
    tunnel:
      image: cloudflare/cloudflared:latest
      command: tunnel --url http://edge:80
      depends_on:
        edge:
          condition: service_started
  ```

- [ ] **5. Write `Caddyfile`**
  ```caddyfile
  localhost {
      handle /api/* {
          reverse_proxy api:4000
      }
      handle /events/* {
          reverse_proxy api:4000 {
              flush_interval -1
          }
      }
      handle /webhooks/* {
          reverse_proxy api:4000
      }
      handle /assets/* {
          reverse_proxy bucket:9000
      }
      handle {
          reverse_proxy web:3000
      }

      header {
          X-Content-Type-Options nosniff
          Referrer-Policy strict-origin-when-cross-origin
          X-Frame-Options DENY
          Content-Security-Policy "default-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'"
      }
  }
  ```

  `/events/*` uses `flush_interval -1` (unbuffered) so SSE chunks reach the browser as
  emitted — without this, Caddy buffers the stream and the live transcript arrives in a
  lump after the interview ends (K14 note).

- [ ] **6. Write `.env.example`**

  Include every key from §9.3 with a safe placeholder and one comment per variable.
  Use the exact key names and comments from IDEA.md §9.3 verbatim, adding the `API_PORT`
  and `INTERNAL_API_URL` keys that the `infra` spec adds. Final list:

  ```dotenv
  # ---- Core ----
  NODE_ENV=development
  PUBLIC_ORIGIN=http://localhost
  API_PORT=4000
  INTERNAL_API_URL=http://api:4000
  NEXT_PUBLIC_DEFAULT_LOCALE=en

  # ---- Database / cache ----
  DATABASE_URL=postgresql://interviewly:interviewly@db:5432/interviewly
  SHADOW_DATABASE_URL=postgresql://interviewly:interviewly@db:5432/interviewly_shadow
  REDIS_URL=redis://cache:6379

  # ---- Auth ----
  SESSION_SECRET=change-me-32-chars-minimum-xxxxxxxx
  SESSION_TTL_DAYS=7
  SESSION_COOKIE_SECURE=true

  # ---- LLM providers ----
  OPENAI_API_KEY=
  GEMINI_API_KEY=

  # ---- Voice ----
  ELEVENLABS_API_KEY=
  ELEVENLABS_AGENT_ID_HR=
  ELEVENLABS_AGENT_ID_TECH=
  ELEVENLABS_WEBHOOK_SECRET=
  VOICE_MAX_ROUND_SECONDS=720
  VOICE_MAX_INTERVIEW_SECONDS=1500

  # ---- Storage ----
  S3_ENDPOINT=http://bucket:9000
  S3_BUCKET=interviewly
  S3_PUBLIC_PREFIX=/assets
  S3_ACCESS_KEY=minioadmin
  S3_SECRET_KEY=minioadmin
  SIGNED_URL_TTL=300

  # ---- Cost guards ----
  AI_ENABLED=true
  BUDGET_USD_TEXT=0.50
  MAX_INTERVIEWS_PER_USER_PER_DAY=5

  # ---- Observability ----
  LOG_LEVEL=info
  LOG_TRANSPORT=stdout
  ELASTICSEARCH_URL=http://es:9200
  ```

- [ ] **7. Write `backend/src/lib/logger.ts`**
  ```ts
  import pino from 'pino';

  export const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    ...(process.env.LOG_TRANSPORT === 'elastic'
      ? { transport: { target: 'pino-elasticsearch', options: { node: process.env.ELASTICSEARCH_URL } } }
      : {}),
  });
  ```

  Add `pino` to `backend/package.json` dependencies.
  Duplicate (or re-export via the workspace) the same factory in `worker/src/lib/logger.ts`.

  K6 contract comment at the top of the file:
  ```ts
  // K6 logger contract: logger.<level>({ traceId, interviewId, ...fields }, "EVENT_NAME")
  // Both traceId and interviewId are mandatory on interview-scoped lines.
  // No secrets, PII, tokens, or PDF content in any log call.
  ```

- [ ] **8. Write `backend/src/lib/env.ts`**

  Zod schema covering all §9.3 keys. Export `config` as the typed validated object:
  ```ts
  import { z } from 'zod';

  const schema = z.object({
    NODE_ENV:                    z.enum(['development', 'production', 'test']).default('development'),
    PUBLIC_ORIGIN:               z.string().url(),
    API_PORT:                    z.coerce.number().default(4000),
    INTERNAL_API_URL:            z.string().url(),
    DATABASE_URL:                z.string(),
    SHADOW_DATABASE_URL:         z.string(),
    REDIS_URL:                   z.string(),
    SESSION_SECRET:              z.string().min(32),
    SESSION_TTL_DAYS:            z.coerce.number().default(7),
    SESSION_COOKIE_SECURE:       z.coerce.boolean().default(true),
    GOOGLE_CLIENT_ID:            z.string().optional(),
    GOOGLE_CLIENT_SECRET:        z.string().optional(),
    OPENAI_API_KEY:              z.string().optional(),
    GEMINI_API_KEY:              z.string().optional(),
    ELEVENLABS_API_KEY:          z.string().optional(),
    ELEVENLABS_AGENT_ID_HR:      z.string().optional(),
    ELEVENLABS_AGENT_ID_TECH:    z.string().optional(),
    ELEVENLABS_WEBHOOK_SECRET:   z.string().optional(),
    VOICE_MAX_ROUND_SECONDS:     z.coerce.number().default(720),
    VOICE_MAX_INTERVIEW_SECONDS: z.coerce.number().default(1500),
    S3_ENDPOINT:                 z.string().url(),
    S3_BUCKET:                   z.string(),
    S3_PUBLIC_PREFIX:            z.string().default('/assets'),
    S3_ACCESS_KEY:               z.string(),
    S3_SECRET_KEY:               z.string(),
    SIGNED_URL_TTL:              z.coerce.number().default(300),
    AI_ENABLED:                  z.coerce.boolean().default(true),
    BUDGET_USD_TEXT:             z.coerce.number().default(0.50),
    MAX_INTERVIEWS_PER_USER_PER_DAY: z.coerce.number().default(5),
    LOG_LEVEL:                   z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
    LOG_TRANSPORT:               z.enum(['stdout', 'elastic']).default('stdout'),
    ELASTICSEARCH_URL:           z.string().optional(),
  });

  const result = schema.safeParse(process.env);
  if (!result.success) {
    const keys = result.error.issues.map(i => i.path.join('.')).join(', ');
    console.error(`ENV_VALIDATION_FAILED: missing or malformed keys: ${keys}`);
    process.exit(1);
  }

  export const config = result.data;
  ```

  Add `zod` to `backend/package.json` dependencies.

- [ ] **9. Write `.github/workflows/ci.yml`**

  Jobs (all triggered on `pull_request`):
  ```yaml
  name: CI
  on: [pull_request]

  jobs:
    lint:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '22', cache: 'npm' }
        - run: npm ci
        - run: npm run lint
        - run: npx commitlint --from ${{ github.event.pull_request.base.sha }}

    typecheck:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '22', cache: 'npm' }
        - run: npm ci
        - run: npm run -w @interviewly/types build
        - run: npm run typecheck

    build:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - run: docker compose build

    compose-check:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - run: docker compose config

    migrate-check:
      runs-on: ubuntu-latest
      services:
        postgres:
          image: postgres:16-alpine
          env: { POSTGRES_USER: ci, POSTGRES_PASSWORD: ci, POSTGRES_DB: ci }
          ports: ['5432:5432']
          options: --health-cmd pg_isready --health-interval 5s --health-retries 10
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '22', cache: 'npm' }
        - run: npm ci
        - run: |
            cd backend
            DATABASE_URL="postgresql://ci:ci@localhost:5432/ci" \
            SHADOW_DATABASE_URL="postgresql://ci:ci@localhost:5432/ci_shadow" \
            npx prisma migrate deploy
            npx prisma migrate diff \
              --from-schema-datasource prisma/schema.prisma \
              --to-schema-datamodel prisma/schema.prisma \
              --exit-code
          name: migrate-check

    unit:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '22', cache: 'npm' }
        - run: npm ci
        - run: npm run -w backend test:unit

    acceptance:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '22', cache: 'npm' }
        - run: npm ci
        - run: npm run test:acceptance

    audit:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - run: npm audit --audit-level=high
  ```

- [ ] **10. Write Dockerfiles skeleton**

  Create minimal multi-stage Dockerfiles so `docker compose build` passes. Feature ledgers
  fill in the application code. Each Dockerfile follows the §10.4 rules (multi-stage
  `deps → build → runner`, `node:22-alpine`, `USER node`, `next/standalone` for frontend).

  `frontend/Dockerfile`, `backend/Dockerfile`, `worker/Dockerfile` — each needs at minimum
  a `FROM node:22-alpine AS runner` stage that the compose healthcheck can reach.

- [ ] **11. Write `.dockerignore` at repo root**
  ```
  node_modules
  .git
  .next
  internal_docs
  .agents
  *.md
  !README.md
  compose.override.yaml
  ```

- [ ] **12. Update `.gitignore`**
  Ensure these entries exist:
  ```
  .env
  compose.override.yaml
  node_modules/
  .next/
  dist/
  ```

- [ ] **13. Create `packages/ai/` stub**
  ```
  packages/ai/
    package.json   { "name": "@interviewly/ai", "version": "0.0.1", "main": "src/index.ts" }
    src/index.ts   // Empty — ai ledger fills this
  ```

## Definition of done
- `docker compose config` exits 0 with no errors (infra AC-2 out-of-ring verification).
- Only `edge` has a `ports:` block in `compose.yaml` — confirmed by `grep -n "ports:" compose.yaml`.
- `migrate` service has no `healthcheck:` and uses `service_completed_successfully` in
  its dependents' `depends_on` blocks.
- `.env.example` is committed and contains every key from §9.3.
- `backend/src/lib/env.ts` exits the process non-zero if `SESSION_SECRET` is shorter than
  32 characters.
- `backend/src/lib/logger.ts` exports a pino `logger` with the K6 contract comment.
- `.github/workflows/ci.yml` contains all 7 jobs: lint, typecheck, build, compose-check,
  migrate-check, unit, acceptance, audit.
- `compose.override.yaml` is in `.gitignore`.

## Verification
```bash
docker compose config
```

Must exit 0 (no config errors, no YAML syntax issues). Then:

```bash
grep -n "ports:" compose.yaml
```

Expected: exactly one match — `edge`'s `ports:` entry.

```bash
grep -c "service_completed_successfully" compose.yaml
```

Expected: ≥ 2 (api and worker both depend on migrate via this condition).

## Notes

(Empty until the task is done. Fill with: what actually happened, every deviation from
the plan, the `docker compose config` output (first 30 lines), the `grep ports` output,
what was deliberately NOT done and why, and a "For feature ledgers" hand-off paragraph
noting how to extend the Caddyfile, add new env keys to `env.ts`, and the branch naming
convention.)
