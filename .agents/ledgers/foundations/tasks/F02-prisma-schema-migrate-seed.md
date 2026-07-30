# F02 — Creating full Prisma schema, migrations, seed, and soft-delete repo helpers
REPO: (this repo) · Depends: — · Status: todo
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
- **The entire schema lands here.** All 14 tables, all enums, all §8.1 indexes, all FKs
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
- [ ] **1. Add Prisma to `backend/package.json`**
  ```json
  "dependencies": { "@prisma/client": "^5" },
  "devDependencies": { "prisma": "^5", "tsx": "^4" },
  "prisma": { "seed": "tsx prisma/seed.ts" }
  ```

- [ ] **2. Write `backend/prisma/schema.prisma`**

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
  enum ChatRole        { user assistant system }
  ```

  All models (column names and types from `db` spec Contracts > Tables):

  ```prisma
  model User {
    id            String    @id @default(cuid())
    email_lower   String    @unique
    password_hash String?
    google_sub    String?   @unique
    role          Role      @default(user)
    locale        String    @default("en")
    created_at    DateTime  @default(now())

    sessions    Session[]
    interviews  Interview[]
    uploads     Upload[]
  }

  model Session {
    id         String    @id @default(cuid())
    user_id    String
    expires_at DateTime
    revoked_at DateTime?
    created_at DateTime  @default(now())

    user User @relation(fields: [user_id], references: [id], onDelete: Restrict)
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
    id          String   @id @default(cuid())
    user_id     String
    storage_key String
    mime        String
    size_bytes  Int
    sha256      String   @unique
    created_at  DateTime @default(now())

    user       User        @relation(fields: [user_id], references: [id], onDelete: Restrict)
    interviews Interview[]
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

- [ ] **3. Run initial migration**
  ```bash
  cd backend
  npx prisma migrate dev --name init
  ```
  This generates `prisma/migrations/<timestamp>_init/migration.sql`. Commit the generated
  file. If `SHADOW_DATABASE_URL` is not set (F03 not landed yet), use
  `--create-only` and apply manually with `prisma migrate deploy` against a running DB.

- [ ] **4. Write `backend/src/lib/db.ts`**
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

- [ ] **5. Write `backend/prisma/seed.ts`**

  The seed must produce (in order, idempotent via `upsert`):
  1. `OccupationCluster` rows — a canonical list of cluster keys and labels covering the
     occupations the product targets (e.g. `software_engineering`, `product_management`,
     `data_science`, `design`, `marketing`, `finance`, `operations`, `hr`). Use `upsert`
     on `key`.
  2. Two `Persona` rows — one HR persona, one Technical persona. Each must have
     `avatar_set` populated with all five `AvatarState` keys pointing to placeholder
     storage keys (e.g. `personas/<id>/idle-placeholder.webp`). These keys become real
     when actual avatar images are uploaded; the seed provides the DB shape.
  3. One demo admin `User` — `email_lower: "admin@demo.com"`, `role: admin`,
     `password_hash` set to an argon2id hash of a known demo password (e.g. `"AdminDemo1!"`).
     **Do not commit the plaintext password to source; hash it in the seed script at
     write time using `@node-rs/argon2`.** `upsert` on `email_lower`.
  4. One sample `Interview` for the demo admin — `state: completed`, `mode: text`,
     a placeholder `job_text`, linked to one of the occupation clusters, with
     `started_at` and `ended_at` set, `ended_reason: completed`. Add linked
     `InterviewRound` rows (one HR, one tech), a few `Question` rows with placeholder
     texts, and matching `Answer` rows. Add a `Report` row with `status: ready` and a
     minimal placeholder `payload` matching the K15 schema shape.

  Run the seed with: `npx tsx prisma/seed.ts` (or via `npm run seed` in `backend/`).

- [ ] **6. Verify schema and migration health**
  See `## Verification` below.

- [ ] **7. Verify repo helpers**
  Write a minimal self-check at the bottom of `db.ts` (behind `if (require.main === module)`)
  that calls `userInterviews` and `activeInterview` against the seeded DB, printing counts.
  This is the "runnable check" that fails if the helper logic breaks.

## Definition of done
- `prisma migrate deploy` on an empty database creates all 14 tables and all enums with
  no error (db spec AC-1).
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
  admin, two personas with all five `avatar_set` keys, occupation clusters, and one
  sample interview (db spec AC-10).
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
Expected: 14 rows.

And the seed:
```bash
npx tsx prisma/seed.ts
# Should print: "Seed complete." with no errors
```

## Notes

(Empty until the task is done. Fill with: what actually happened, every deviation from
the plan — especially any column name or type that differs from the spec, the exact
migration timestamp, the seed completion output verbatim, what was deliberately NOT done
and why, and a "For feature ledgers" hand-off paragraph stating the migration rule and
where to find the repo helpers.)
