# Foundations — REFERENCE (read this once, then you don't need to spelunk)

Single orientation doc for any agent executing a foundations task. **All four foundations
tasks have landed, so every path below now exists**; re-verified against the code as of
2026-07-30 (post-F02). If reality diverges after a task lands, trust the code and patch this
file.

## Services, ports, roles (post-foundations)

| Service | Package / image | Port (internal) | DB role | Trust |
|---------|-----------------|-----------------|---------|-------|
| `edge` | `caddy:2-alpine` | 80 (host) | none | public |
| `web` | `frontend/Dockerfile` | 3000 | none | internal |
| `api` | `backend/Dockerfile` | 4000 | read/write | internal |
| `worker` | `worker/Dockerfile` | none | read/write | internal |
| `db` | `postgres:16-alpine` | 5432 | primary | internal |
| `cache` | `redis:7-alpine` | 6379 | sessions/rate/BullMQ | internal |
| `bucket` | `minio/minio` | 9000 | object store | internal |
| `migrate` | reuses `api` image | — one-shot | migrator | internal |

Only `edge` publishes a host port (K14, ADR-F04).

## Commands (post-foundations)

```bash
# Boot default stack (scored path)
docker compose up

# Boot with developer extras (hot reload, tunnel)
docker compose -f compose.yaml -f compose.dev.yaml up

# Boot with observability
docker compose --profile observability up

# Run migrations only
docker compose run --rm migrate

# Seed database
docker compose run --rm api npm run seed

# Build shared types package
npm run -w @interviewly/types build

# Typecheck everything
npm run typecheck

# Lint everything
npm run lint

# Run acceptance ring
npm run test:acceptance

# Migrate-check (CI gate)
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

## Key code anchors (post-foundations)

| Path | What lives here |
|------|-----------------|
| `frontend/styles/tokens.css` | `:root` CSS custom properties — the single token source (F01) |
| `frontend/messages/en.json` | English locale strings keyed by error code and UI surface (F01) |
| `frontend/messages/tr.json` | Turkish locale strings — same keys as `en.json` (F01) |
| `frontend/src/i18n.ts` | `next-intl` routing config (F01) |
| `frontend/src/middleware.ts` | Locale detection middleware (F01) |
| `packages/types/src/index.ts` | `@interviewly/types` barrel — re-exports `ErrorCode`, `AvatarState`, shared API types (F01) |
| `backend/src/lib/error-codes.ts` | Error-code registry: `const ERROR_CODES = { … }` (F01) |
| `backend/prisma/schema.prisma` | Complete Prisma schema — 15 tables, 18 enums, 7 indexes (F02) |
| `backend/prisma/migrations/` | Timestamped Prisma migrations; the first is `20260730130638_init` (F02) |
| `backend/prisma/seed.ts` | Seed script: admin user, personas, occupation clusters, mascot set, sample interview (F02) |
| `backend/prisma/fixtures/sample-listing.txt` | The *Try a sample listing* job text, §4.3.1 (F02) |
| `backend/src/lib/db.ts` | Prisma client singleton + repo helpers (`userInterviews`, `activeInterview`, `recordLlmCall`) (F02) |
| `backend/src/lib/logger.ts` | Pino logger factory — `logger.info({…, traceId, interviewId}, "EVENT")` (F03) |
| `backend/src/lib/env.ts` | Zod env schema + fail-fast startup check (F03) |
| `compose.yaml` | Service inventory — default profile (F03) |
| `compose.dev.yaml` | Dev extras — tunnel, host port publishing (F03) |
| `Caddyfile` | Edge routes: `/api/*` → api, `/assets/*` → minio, `/*` → web (F03) |
| `.env.example` | Every validated key with safe placeholders (F03) |
| `db/init.sql` | Creates `interviewly` and `interviewly_shadow` databases (F03) |
| `.github/workflows/ci.yml` | CI: lint → typecheck → build → migrate-check → acceptance (F03) |

## Schema (post-F02)

15 tables (all RESTRICT FKs, soft-delete on `interviews` only):
`users`, `sessions`, `email_tokens`, `personas`, `occupation_clusters`, `interviews`,
`interview_rounds`, `questions`, `answers`, `reports`, `report_questions`,
`voice_sessions`, `uploads`, `chat_messages`, `llm_calls`.

`email_tokens` (K8.6) holds `sha256(token)` only, two `kind`s (`verify`, `reset`), single-use via a
guarded `consumed_at` update. `users` additionally carries `email_verified_at`, `profile` (§3.3
onboarding), `cv_upload_id` and `onboarding_completed_at`; `uploads` carries `kind ∈ {listing, cv}`.

Full column list in `tasks/F02-*.md` and `backend/prisma/schema.prisma`.

Helpers in `backend/src/lib/db.ts` — user-facing modules use these, never
`prisma.interview.findMany` (K13):
- `userInterviews(userId, { cursor?, limit? })` — non-deleted interviews, newest first, paginated.
- `activeInterview(id)` — single non-deleted interview or `null`.
- `recordLlmCall(data)` — inserts the `llm_calls` row and increments `spent_usd` in **one**
  transaction (K13, §7.3); returns committed totals plus `exhausted`.

Prisma is **6.19.3** (ADR-F13, not the `^5` the F02 task file names). Feature ledgers add
indexes and nullable columns only, each in its own `npx prisma migrate dev --name <slug>` run
from `backend/`, rebased before merge. `npm run -w backend db:check` runs `db.ts`'s soft-delete
self-check against a seeded database.

## Conventions

- **Error codes:** `SCREAMING_SNAKE_CASE` strings from `error-codes.ts`. Never display strings.
- **Log lines:** `logger.<level>({ traceId, interviewId, …fields }, "EVENT_NAME")` — both IDs always present on interview-scoped lines.
- **Env:** only the typed config object from `env.ts` is used; `process.env` reads outside it are a defect.
- **Migrations:** `prisma migrate dev --name <slug>` locally; `prisma migrate deploy` in production/CI.
- **Commit format:** Conventional Commits — `feat:`, `fix:`, `chore:`, etc. Task commits: `F01: <title>`.
- **Schema mutations after F02:** indexes and nullable columns only, in their own migration, rebased before merge.
