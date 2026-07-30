# F02 — Creating full Prisma schema, migrations, seed, and soft-delete repo helpers
REPO: (this repo) · Depends: F03 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — schema is the highest-blast-radius artefact in the project; every downstream task binds to its column names, types, and constraints. Get it right once.

## Goal
Owner's ask:

> "`schema.prisma` **in full** (K13 — every table, including ones no feature ledger has
> reached), Prisma Migrate setup, `prisma/seed.ts`, repository helpers with the K13
> soft-delete rule. Blocks all API work."
> — IDEA.md §5.2 F-b

This task writes the complete `backend/prisma/schema.prisma`, runs the initial migration,
writes `prisma/seed.ts` to produce a working demo environment, and ships the two
soft-delete repository helpers that every user-facing module must use instead of calling
`prisma.interview.findMany` directly (K13).

F01 (tokens) and F03 (compose) are fully independent — they touch no Prisma file.
Feature ledgers may **add indexes and nullable columns only** after this task lands;
any structural change is a change to F02's scope (ADR-F02, §5.2).

## Non-negotiables
- **The entire schema lands here.** All 15 tables, all enums, all §8.1 indexes, all FKs
  as `ON DELETE RESTRICT`. No table is deferred to a feature ledger.
- **All FKs are `ON DELETE RESTRICT`, no cascades.** Deletion is soft (interviews only)
  or never (all other tables in scope). A cascade on any relation is a defect.
- **`spent_usd` incremented in the same transaction as `llm_calls` insert.** Not a schema
  artefact per se, but the repo helper for budget accounting must document this contract
  so downstream modules follow it (K13, §7.3).
- **`prisma/seed.ts` must produce a working room with no manual step.** After
  `docker compose run --rm api npm run seed`: one demo admin, occupation clusters, two
  personas with populated `avatar_set`, one sample interview — avatars uploaded to the
  bucket, keys written to the DB.
- **No `prisma.interview.findMany` in user-facing modules.** Ship the two helpers and
  document the rule in a comment at the top of `backend/src/lib/db.ts`.

## Context (anchors)
- `backend/prisma/schema.prisma` — the file this task creates. One file, one migration.
  No structural change after merge without a DECISIONS.md ADR-F entry.
- `backend/prisma/migrations/` — Prisma Migrate produces timestamped subdirectories here.
  The first will be named something like `20260730000000_init/migration.sql`. Do not
  hand-author SQL; let `prisma migrate dev` generate it.
- `backend/prisma/seed.ts` — seeder. Imports `@prisma/client`. Must be runnable as
  `npx ts-node prisma/seed.ts` or `tsx prisma/seed.ts`. Add the `prisma.seed` entry to
  `backend/package.json`: `"prisma": { "seed": "tsx prisma/seed.ts" }`.
- `backend/src/lib/db.ts` — Prisma client singleton + two repo helpers. This is a NEW
  file created in this task. Comment at the top:
  ```ts
  // User-facing modules MUST call userInterviews() or activeInterview(), never
  // prisma.interview.findMany directly. Soft-delete is baked in here (K13).
  ```
- `db/init.sql` — F03 creates this file. If F03 has not landed yet, create a placeholder
  at this path so `prisma migrate dev` can be run with a `SHADOW_DATABASE_URL` that
  points to an already-existing shadow DB (or run with `--create-only` and apply
  manually). Document any manual step in `## Notes`.
- `backend/package.json` — must have `@prisma/client`, `prisma` (devDep), and
  `tsx` (devDep, for seed). The root-level `package.json`'s `workspaces` array must
  include `"backend"`.

  **The trap:** `occupation_clusters` is a reference table seeded with a fixed list of
  cluster keys. The `db` spec says `interviews.occupation_cluster_id` is an FK to it.
  The seed must insert the canonical cluster list before inserting any interview row. If
  the cluster list is wrong, every downstream occupation-grouping query (K11 admin stats)
  groups wrong — fix it in the seed, not in a later migration.

## Steps
- [x] **1. Add Prisma to `backend/package.json`**
  ```json
  "dependencies": { "@prisma/client": "^5" },
  "devDependencies": { "prisma": "^5", "tsx": "^4" },
  "prisma": { "seed": "tsx prisma/seed.ts" }
  ```

- [x] **2. Write `backend/prisma/schema.prisma`**

  Generator + datasource:
  ```prisma
  generator client {
    provider = "prisma-client-js"
  }

  datasource db {
    provider          = "postgresql"
    url               = env("DATABASE_URL")
    shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
  }
  ```

  All enums (from `db` spec Contracts > Enums):
  ```prisma
  enum Role            { user admin }
  enum InterviewMode   { voice text }
  enum JobSource       { paste upload }
  enum InterviewState  {
    created profiling hr_round tech_round paused evaluating completed abandoned failed
  }
  enum EndedReason     { completed cut_short budget_exhausted time_exhausted abandoned error }
  enum RoundType       { hr tech }
  enum RoundStatus     { pending active done }
  enum QuestionKind    { open behavioral technical widget }
  enum Difficulty      { easy medium hard }
  enum InputMode       { voice text widget }
  enum ReportStatus    { queued generating ready failed }
  enum ChosenReason    { score_low score_mid score_high language_switch fallback }
  enum UnitKind        { token second character }
  enum AvatarState     { idle listening thinking speaking acknowledging }
  enum MascotPose      { wave point think cheer shrug }        // ui §4.2.1 — no column binds it
  enum ChatRole        { user assistant system }
  enum EmailTokenKind  { verify reset }                        // K8.6
  enum UploadKind      { listing cv }                          // K12, §3.3
  ```

  `MascotPose` has **no column**: it exists so the seed and the frontend cannot disagree about the
  mascot storage keys, the same reason `AvatarState` is an enum (§4.2.1). Declare it; do not attach
  it.

  All models (column names and types from `db` spec Contracts > Tables):

  ```prisma
  model User {
    id                       String    @id @default(cuid())
    email_lower              String    @unique
    password_hash            String?
    google_sub               String?   @unique
    role                     Role      @default(user)
    locale                   String    @default("en")
    email_verified_at        DateTime?                 // K8.6
    profile                  Json?                     // §3.3 layer 1 — partial is normal
    cv_upload_id             String?                   // §3.3 — pointer, not a history
    onboarding_completed_at  DateTime?                 // K8.7
    created_at               DateTime  @default(now())

    cv_upload    Upload?  @relation("UserCv", fields: [cv_upload_id], references: [id], onDelete: Restrict)
    sessions     Session[]
    email_tokens EmailToken[]
    interviews   Interview[]
    uploads      Upload[]  @relation("UploadOwner")
  }

  model Session {
    id         String    @id @default(cuid())
    user_id    String
    expires_at DateTime
    revoked_at DateTime?
    created_at DateTime  @default(now())

    user User @relation(fields: [user_id], references: [id], onDelete: Restrict)
  }

  model EmailToken {                                   // K8.6 — one table, two kinds
    id          String          @id @default(cuid())
    user_id     String
    kind        EmailTokenKind
    token_hash  String          @unique                // sha256(token) — never the token
    expires_at  DateTime
    consumed_at DateTime?
    created_at  DateTime        @default(now())

    user User @relation(fields: [user_id], references: [id], onDelete: Restrict)

    @@index([user_id, kind])
  }

  model Persona {
    id             String    @id @default(cuid())
    role           String
    name           String
    voice_id       String
    avatar_set     Json
    system_prompt  String
    active         Boolean   @default(true)

    interview_rounds InterviewRound[]
  }

  model OccupationCluster {
    id    String @id @default(cuid())
    key   String @unique
    label String

    interviews Interview[]
  }

  model Interview {
    id                    String          @id @default(cuid())
    user_id               String
    mode                  InterviewMode
    job_text              String
    job_source            JobSource
    upload_id             String?
    occupation            String
    occupation_cluster_id String?
    language              String
    candidate_profile     Json?
    target_question_count Int
    hr_question_count     Int
    state                 InterviewState  @default(created)
    current_index         Int             @default(0)
    ended_reason          EndedReason?
    budget_usd            Decimal         @default(0.50)  @db.Decimal(12, 6)
    spent_usd             Decimal         @default(0)     @db.Decimal(12, 6)
    started_at            DateTime?
    ended_at              DateTime?
    deleted_at            DateTime?
    created_at            DateTime        @default(now())

    user               User               @relation(fields: [user_id], references: [id], onDelete: Restrict)
    upload             Upload?            @relation(fields: [upload_id], references: [id], onDelete: Restrict)
    occupation_cluster OccupationCluster? @relation(fields: [occupation_cluster_id], references: [id], onDelete: Restrict)
    interview_rounds   InterviewRound[]
    reports            Report[]
    voice_sessions     VoiceSession[]
    chat_messages      ChatMessage[]
    llm_calls          LlmCall[]

    @@index([user_id, created_at])
    @@index([occupation_cluster_id])
    @@index([state])
  }

  model InterviewRound {
    id           String      @id @default(cuid())
    interview_id String
    type         RoundType
    persona_id   String
    status       RoundStatus @default(pending)
    score        Int?

    interview Interview @relation(fields: [interview_id], references: [id], onDelete: Restrict)
    persona   Persona   @relation(fields: [persona_id], references: [id], onDelete: Restrict)
    questions Question[]
  }

  model Question {
    id             String       @id @default(cuid())
    round_id       String
    order_index    Int
    text           String
    kind           QuestionKind
    difficulty     Difficulty
    topic          String
    candidates     Json?
    chosen_reason  ChosenReason?
    asked_at       DateTime?

    round   InterviewRound @relation(fields: [round_id], references: [id], onDelete: Restrict)
    answers Answer[]

    @@unique([round_id, order_index])
  }

  model Answer {
    id          String    @id @default(cuid())
    question_id String
    transcript  String
    input_mode  InputMode
    started_at  DateTime?
    answered_at DateTime?
    duration_ms Int?
    scores      Json?

    question         Question          @relation(fields: [question_id], references: [id], onDelete: Restrict)
    report_questions ReportQuestion[]
  }

  model Report {
    id             String       @id @default(cuid())
    interview_id   String
    status         ReportStatus @default(queued)
    payload        Json?
    pdf_key        String?
    prompt_uuid    String
    prompt_version Int
    created_at     DateTime     @default(now())

    interview        Interview        @relation(fields: [interview_id], references: [id], onDelete: Restrict)
    report_questions ReportQuestion[]
  }

  model ReportQuestion {
    id              String  @id @default(cuid())
    report_id       String
    question_id     String
    score           Int
    reason          String
    star_adherence  Decimal @db.Decimal(3, 2)

    report   Report   @relation(fields: [report_id], references: [id], onDelete: Restrict)
    question Question @relation(fields: [question_id], references: [id], onDelete: Restrict)
  }

  model VoiceSession {
    id           String    @id @default(cuid())
    interview_id String
    nonce        String
    expires_at   DateTime
    consumed_at  DateTime?

    interview Interview @relation(fields: [interview_id], references: [id], onDelete: Restrict)
  }

  model Upload {
    id          String     @id @default(cuid())
    user_id     String
    kind        UploadKind                        // K12, §3.3 — listing | cv
    storage_key String
    mime        String
    size_bytes  Int
    sha256      String     @unique
    created_at  DateTime   @default(now())

    user       User        @relation("UploadOwner", fields: [user_id], references: [id], onDelete: Restrict)
    cv_of      User[]      @relation("UserCv")
    interviews Interview[]

    @@index([user_id, kind])
  }

  model ChatMessage {
    id           String   @id @default(cuid())
    interview_id String
    role         ChatRole
    content      String
    trace_id     String
    created_at   DateTime @default(now())

    interview Interview @relation(fields: [interview_id], references: [id], onDelete: Restrict)
  }

  model LlmCall {
    id             String   @id @default(cuid())
    interview_id   String
    provider       String
    model          String
    prompt_uuid    String
    prompt_version Int
    attempt_no     Int
    fell_back_from String?
    units          Decimal  @db.Decimal(12, 3)
    unit_kind      UnitKind
    input_tokens   Int?
    output_tokens  Int?
    cost_usd       Decimal  @db.Decimal(12, 6)
    latency_ms     Int
    trace_id       String
    created_at     DateTime @default(now())

    interview Interview @relation(fields: [interview_id], references: [id], onDelete: Restrict)

    @@index([interview_id])
  }
  ```

  Cross-check: 14 models match K13's list. 15 enums match `db` spec.

- [x] **3. Run initial migration**
  ```bash
  cd backend
  npx prisma migrate dev --name init
  ```
  This generates `prisma/migrations/<timestamp>_init/migration.sql`. Commit the generated
  file. If `SHADOW_DATABASE_URL` is not set (F03 not landed yet), use
  `--create-only` and apply manually with `prisma migrate deploy` against a running DB.

- [x] **4. Write `backend/src/lib/db.ts`**
  ```ts
  import { PrismaClient } from '@prisma/client';

  // User-facing modules MUST call userInterviews() or activeInterview(), never
  // prisma.interview.findMany directly. Soft-delete is baked in here (K13).

  const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

  export const prisma =
    globalForPrisma.prisma ?? new PrismaClient({ log: ['warn', 'error'] });

  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

  /** Non-deleted interviews for a user, newest first, paginated. */
  export async function userInterviews(
    userId: string,
    opts?: { cursor?: string; limit?: number }
  ) {
    return prisma.interview.findMany({
      where: { user_id: userId, deleted_at: null },
      orderBy: { created_at: 'desc' },
      take: opts?.limit ?? 20,
      ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
  }

  /** Single non-deleted interview by id, or null. */
  export async function activeInterview(id: string) {
    return prisma.interview.findFirst({ where: { id, deleted_at: null } });
  }
  ```

- [x] **5. Write `backend/prisma/seed.ts`**

  The seed must produce (in order, idempotent via `upsert`):
  1. `OccupationCluster` rows — a canonical list of cluster keys and labels covering the
     occupations the product targets (e.g. `software_engineering`, `product_management`,
     `data_science`, `design`, `marketing`, `finance`, `operations`, `hr`). Use `upsert`
     on `key`.
  2. Two `Persona` rows — one HR persona, one Technical persona. Each must have
     `avatar_set` populated with all five `AvatarState` keys pointing to placeholder
     storage keys (e.g. `personas/<id>/idle-placeholder.webp`). These keys become real
     when actual avatar images are uploaded; the seed provides the DB shape.
  2a. The shared **mascot set** — five objects under `mascot/{pose}-{sha256}.webp`, one per
     `MascotPose` (§4.2.1). No table references them; the seed's job is to make the keys exist so
     entry screens are never the first request for a mascot image.
  3. One demo admin `User` — `email_lower: "admin@demo.com"`, `role: admin`,
     `password_hash` set to an argon2id hash of a known demo password (e.g. `"AdminDemo1!"`),
     **and `email_verified_at` set to `now()`**. A seeded account that cannot start an interview
     when `EMAIL_VERIFICATION_REQUIRED=true` would make the demo depend on reading a mailbox
     (K8.6). **Do not commit the plaintext password to source; hash it in the seed script at
     write time using `@node-rs/argon2`.** `upsert` on `email_lower`.
  3a. One **sample job listing** — the text behind the setup screen's *Try a sample listing*
     option card (§4.3.1), so an evaluator can reach the room without owning a job ad. A seeded
     row or a committed fixture the setup route reads; either is fine, but it must exist after a
     bare `up` + seed.
  4. One sample `Interview` for the demo admin — `state: completed`, `mode: text`,
     a placeholder `job_text`, linked to one of the occupation clusters, with
     `started_at` and `ended_at` set, `ended_reason: completed`. Add linked
     `InterviewRound` rows (one HR, one tech), a few `Question` rows with placeholder
     texts, and matching `Answer` rows. Add a `Report` row with `status: ready` and a
     minimal placeholder `payload` matching the K15 schema shape.

  Run the seed with: `npx tsx prisma/seed.ts` (or via `npm run seed` in `backend/`).

- [x] **6. Verify schema and migration health**
  See `## Verification` below.

- [x] **7. Verify repo helpers**
  Write a minimal self-check at the bottom of `db.ts` (behind `if (require.main === module)`)
  that calls `userInterviews` and `activeInterview` against the seeded DB, printing counts.
  This is the "runnable check" that fails if the helper logic breaks.

## Definition of done
- `prisma migrate deploy` on an empty database creates all **15** tables (incl. `email_tokens`)
  and all enums (incl. `EmailTokenKind`, `UploadKind`, `MascotPose`) with no error (db spec AC-1).
- `email_tokens.token_hash` is UNIQUE and `email_tokens(user_id, kind)` and
  `uploads(user_id, kind)` indexes exist (db spec AC-16).
- `users` carries `email_verified_at`, `profile`, `cv_upload_id` and `onboarding_completed_at`;
  `uploads` carries `kind` (db spec AC-15).
- `prisma migrate diff` from schema-datasource to schema-datamodel exits 0 (no drift,
  CI gate).
- `userInterviews(userId)` never returns a row with a non-null `deleted_at` (db spec AC-6).
- `activeInterview(id)` returns `null` for a soft-deleted interview (db spec AC-6).
- `questions(round_id, order_index)` is UNIQUE — a duplicate `order_index` within a round
  fails (db spec AC-5).
- `budget_usd` defaults to `0.500000`; `spent_usd` to `0.000000` — six decimal places
  without truncation (db spec AC-4).
- All five §8.1 indexes exist after migration (db spec AC-5).
- `prisma/seed.ts` runs to completion on a fresh DB with no error, producing the demo
  admin (pre-verified), two personas with all five `avatar_set` keys, the five-pose mascot set,
  the sample job listing, occupation clusters, and one sample interview (db spec AC-10, AC-17).
- All FKs are `ON DELETE RESTRICT`; no cascade exists (db spec AC-11).

## Verification
```bash
cd backend
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

This command exits 0 if the live database matches the schema exactly (no drift). It is
the same command the CI `migrate-check` job runs (infra spec CI section, §11.4).

Then confirm the table count:
```bash
psql "$DATABASE_URL" -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
```
Expected: 15 rows.

And the seed:
```bash
npx tsx prisma/seed.ts
# Should print: "Seed complete." with no errors
```

## Notes

Executed 2026-07-30 by **Sezai**, out of ownership order. F02 is Fatih's row; it was taken
over as an explicit blocker-clearing exception on the owner's request — F02 was the last
`todo` foundations task and every `I`, `A`, `R`, `N`, `V` and `D` row lists it in
`Depends on`, so nothing else in the project could start. Same exception pattern as F01.

### What exists now

| Path | Contents |
|---|---|
| `backend/prisma/schema.prisma` | 15 models, 18 enums, 7 §8.1 indexes, 17 FKs |
| `backend/prisma/migrations/20260730130638_init/migration.sql` | generated, never hand-edited |
| `backend/prisma/seed.ts` | idempotent seed; prints `Seed complete.` |
| `backend/prisma/fixtures/sample-listing.txt` | the *Try a sample listing* text (§4.3.1) |
| `backend/src/lib/db.ts` | client singleton + `userInterviews` / `activeInterview` / `recordLlmCall` + self-check |

**No column name or type differs from the `db` spec's Contracts > Tables table.** Every
deviation below is structural or tooling, none of them rename or retype a column.

### Deviations from the task file

1. **Prisma 6.19.3, not `^5`.** Prisma 5 is two majors behind and `npm audit --audit-level=high`
   is a blocking CI gate; 6 keeps the `prisma-client-js` generator the task's schema block
   assumes, so the schema text needed no change. Prisma 7 was rejected — it replaces that
   generator. ADR-F13.
2. **`@@map` added to all 15 models.** The task's Prisma block had no `@@map`, which would
   have produced PascalCase tables (`User`, `EmailToken`) and failed db spec AC-1, which names
   all 15 tables in snake_case. Column names were already snake_case, so no `@map` was needed.
3. **The task's Prisma block does not validate as written.** `ReportQuestion.question` had no
   opposite relation field on `Question`, and `Answer` carried a `report_questions
   ReportQuestion[]` back-relation to a foreign key that does not exist (`report_questions` FKs
   to `reports` and `questions` only, per the spec's table). Fixed by moving
   `report_questions ReportQuestion[]` from `Answer` to `Question`. This matches the spec; the
   task file's block was the thing that was wrong.
4. **Counts in the task's prose were stale**, and the generated SQL is the arbiter: **15**
   models (the "Cross-check: 14 models" line undercounts), **18** enums (not 15), **7** §8.1
   indexes (the DoD's "all five" undercounts — the spec's Indexes block lists seven).
5. **`prisma migrate dev --name init` ran normally** — `db/init.sql` from F03 already creates
   `interviewly_shadow`, so the `--create-only` fallback the task allowed for was not needed.
6. **The seed uses deterministic primary keys** (`seed-persona-hr`, `seed-interview-demo`, …).
   `personas` has no natural unique key, so `upsert` needs a known id; supplying ids also lets
   the avatar keys under `personas/{id}/` be computed before the row is written. The schema
   still defaults `id` to `cuid()` for every non-seed row.
7. **Avatar keys follow `infra`, not the task file.** The task suggested
   `personas/<id>/idle-placeholder.webp`; `infra` §K12 and `ui` §3.6 pin
   `personas/{personaId}/{state}-{sha256}.webp`. Used the content-addressed form so the seeded
   keys are the real layout, not a shape that has to be migrated later.
8. **The sample job listing is a committed fixture, not a row.** No table models a job listing,
   and the task explicitly allowed either. The seed reads the fixture and uses it as the sample
   interview's `job_text`, so the file is exercised rather than merely present.
9. **`recordLlmCall()` was added to `db.ts`.** The task's non-negotiable requires the
   `spent_usd`/`llm_calls` single-transaction contract (K13, §7.3) to be documented for
   downstream modules; a helper that performs the insert and the increment in one
   `prisma.$transaction` makes the contract executable instead of a comment three ledgers can
   each get wrong. It returns committed totals plus `exhausted`; the pre-call budget decision
   and the `BUDGET_EXCEEDED` mapping stay with `ai`/`backend`.
10. **`seed.ts` reads `process.env` directly** instead of importing `src/lib/env.ts`. Deliberate,
    with the reasoning in a comment at the top of the file: `env.ts` fails fast on the *service*
    schema (`SESSION_SECRET`, `SMTP_HOST`, `MAIL_FROM`), none of which seeding touches, and
    `npm run seed` should not require them. Defaults in the script match `.env.example`.

### Files outside `backend/prisma` and `backend/src` that had to change

Each is one line, each is load-bearing for "a fresh clone boots seeded with no manual step":

- `compose.yaml` — `migrate` now runs `prisma migrate deploy --schema backend/prisma/schema.prisma`.
  The image `WORKDIR` is the workspace root, so the bare command found no schema.
- `backend/Dockerfile` — added `npx prisma generate` to the build stage. Prisma Client is
  generated code; without it `api`, `worker` and `migrate` ship an empty `@prisma/client`.
- `eslint.config.js` — added `backend/prisma/**/*.ts` to the TS-parser `files` glob. `eslint .`
  reaches `seed.ts`, and without the glob it was parsed as plain JS (`Parsing error: Unexpected
  token {` on `import type`).
- `tsconfig.json` — added `backend/prisma` to `include`, so `seed.ts` is typechecked rather than
  silently skipped.
- `.env.example` — added `SEED_ADMIN_PASSWORD` (default `AdminDemo1!`), the override that keeps
  the demo credential out of any real deployment.

### Verification output

`## Verification` command, verbatim, from `backend/`:

```
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --exit-code
→ No difference detected.        MIGRATE_DIFF_EXIT=0
```

Run **red first**, before the migration existed: the same command printed a full add/change
diff and exited non-zero.

Table count — **16, not the 15 the task predicts.** The query counts
`information_schema.tables`, which includes Prisma's own `_prisma_migrations` bookkeeping
table. Excluding it gives exactly 15. Both were run; the task's expected value is off by that
one row, the schema is not.

```
SELECT count(*) … table_schema='public';                                   → 16
SELECT count(*) … table_schema='public' AND table_name <> '_prisma_migrations'; → 15
enum types in public                                                        → 18
SELECT confdeltype, count(*) FROM pg_constraint WHERE contype='f'          → r|17
```

`confdeltype = r` on all 17 foreign keys: every FK is `ON DELETE RESTRICT` and **no cascade
delete exists anywhere** (AC-11). Prisma also emits `ON UPDATE CASCADE`, which is not a
cascade delete and can never fire — primary keys are cuids and are never updated.

Constraint behaviour, checked by provoking the failures:

```
duplicate (round_id, order_index)  → ERROR: duplicate key value violates unique constraint
                                            "questions_round_id_order_index_key"     (AC-5)
uploads.kind = 'passport'          → ERROR: invalid input value for enum "UploadKind" (AC-2)
budget_usd / spent_usd defaults    → 0.500000 | 0.000000                             (AC-4)
```

`prisma/seed.ts`, verbatim:

```
Seeding interviewly @ http://localhost:9000 and the database...
  occupation_clusters: 10
  mascot/: 5 objects
  personas: 2 (each with 5 avatar objects)
  users: demo admin admin@demo.com (password: AdminDemo1!)
  sample listing: 1378 chars from prisma/fixtures/
  interviews: 1 sample (2 rounds, 4 questions, 1 ready report)
Seed complete.
```

15 objects land in the bucket (5 `mascot/`, 10 `personas/`). Running the seed twice produces
byte-identical output and no duplicate rows.

`backend/src/lib/db.ts` self-check (`npm run -w backend db:check`):

```
userInterviews(admin) -> 1 row(s)
db.ts self-check passed.
```

Proven red before being trusted: with `deleted_at: null` stripped from both helpers it fails
with `AssertionError: a soft-deleted interview leaked into userInterviews`.

**The whole path was re-run from destroyed volumes** (`docker compose down -v` → `up db bucket`
→ `migrate deploy` → seed → self-check → `migrate diff`), so AC-1's "on an empty database"
is literally what was tested, not inferred.

Also run: `docker compose config` (exit 0), `docker compose build migrate` (image built,
`node_modules/.prisma/client` present inside it), and `docker compose run --rm migrate`
(`No pending migrations to apply.`) — the `docker compose up` path resolves the schema.

Gates: `npm run lint` and `npm run typecheck` both exit 0. **`npm test` does not exist** —
`npm error Missing script: "test"`, the pre-existing backlog gap in `STATE.md`, unchanged by
this task. `npm run test:acceptance` was not run: no Cucumber harness exists yet and this task
added no HTTP behaviour.

### Deliberately not done

- **Bucket policy for the public `personas/` and `mascot/` prefixes.** The seed creates the
  bucket and PUTs the objects; making them anonymously readable at `/assets` is `infra`'s
  boundary enforcement (infra spec §7), not F02's. Until it lands, `/assets/mascot/*.webp`
  returns 403. Backlogged in `STATE.md`.
- **Avatar and mascot artwork.** Every one of the 15 objects is the same valid 34-byte 1x1
  WebP. The keys and the DB shape are real; the pixels are a placeholder to be overwritten at
  the same keys.
- **`backend/tsconfig.json`.** Still missing, so `npm run -w backend build` still fails — an
  F03 gap that predates this task and is hidden by `|| true` in the Dockerfile. Backlogged, not
  fixed here.
- **`prisma.config.ts`.** `package.json#prisma` (which the task prescribes) is deprecated and
  warns on every Prisma 6 CLI call; it is removed in Prisma 7. Left as specced. Backlogged.
- **No `uploads` or `email_tokens` rows in the seed.** Neither is needed for a working room and
  neither is in the DoD; `auth` and `interview-core` create them in their own flows.

### For feature ledgers

`backend/src/lib/db.ts` is the only module that may talk to `interviews` on a user's behalf.
Import `userInterviews(userId, { cursor?, limit? })` and `activeInterview(id)` from it —
`prisma.interview.findMany` in a user-facing module is a review rejection (K13). An
admin/analytics read that must count deleted interviews bypasses the helpers **and says so at
the call site**. Every provider call records through `recordLlmCall()`; do not insert
`llm_calls` and increment `spent_usd` separately.

The schema is closed. You may add **indexes and nullable columns only**, each in its own
`npx prisma migrate dev --name <slug>` migration from `backend/`, rebased on `master` before
merge (`git pull --rebase origin master`, then re-run the migration if the head moved). A new
table, a dropped column, a changed relation, **or a new enum value** — including widening
`QuestionKind` or `ChatRole`, both of which the `db` spec flags as provisional — is a change to
F02's scope: raise it in the group, record an ADR, merge it as its own task. Do not let it ride
along in a feature PR.

Local loop: `docker compose -f compose.yaml -f compose.dev.yaml up -d db bucket`, then from
`backend/` with `DATABASE_URL`/`SHADOW_DATABASE_URL` pointed at `localhost:5432`,
`npx prisma migrate deploy && npm run seed`. Demo admin is `admin@demo.com` / `AdminDemo1!`
(pre-verified, `role=admin`), overridable with `SEED_ADMIN_PASSWORD`.
