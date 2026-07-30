---
task: F02
author: Sezai
sessions: [2026-07-30]
model: claude-opus-5
model_recommended: claude-opus-4.8
iterations: 2
tools: [superpowers:using-superpowers, ponytail, caveman]
---

## Session 1 — 2026-07-30

### What I asked for / what came back

Ran `.agents/EXECUTE.md` as Sezai. § 4 gave me nothing: `F01`, `F03`, `F04` were all `done`
and every one of my `I01`–`I15` rows was blocked on `F02`, which is Fatih's. § 4 rule 3 says
to print `BLOCKED I01 needs F02 (todo, owner Fatih)` and end the run. The owner overrode that
in the invocation — Fatih has no time and F02 blocks the entire project — so I took the row.
Same exception pattern F01 already carries in its Notes.

The first run ended before touching code anyway: `MODELS.md` marks F02 opus-tier and the
session was Sonnet, so § 5 fired and I printed
`TIER F02 needs opus-tier (claude-opus-4.8), running claude-sonnet-5` and stopped. The human
relaunched on Opus 5. That gate did its job — a Sonnet session was about to author the
highest-blast-radius file in the repo.

`model` (`claude-opus-5`) and `model_recommended` (`claude-opus-4.8`) differ because the
available Opus is now 5; the *tier* the gate checks — opus — matched, which is what § 5
actually requires. Not quietly aligned, per the devlog contract.

### Methodology trace

There is no Gherkin here — F02 ships a schema, not an endpoint — so the ATDD ordering was
applied to the two things that *are* executable, and both were seen red first:

```
db spec AC-1        → `prisma migrate diff --exit-code` before any migration existed
                    → RED (full add/change diff, non-zero exit)
                    → migration 20260730130638_init generated → GREEN ("No difference detected.")

db spec AC-6        → db.ts self-check, with `deleted_at: null` stripped from BOTH helpers
                    → RED (AssertionError: a soft-deleted interview leaked into userInterviews)
                    → filter restored → GREEN ("db.ts self-check passed.")
```

The second one matters more than it looks. The task file asks for a self-check that "prints
counts", which would have passed against a broken helper — a test that cannot fail is not a
test. I rewrote it to create a probe interview, soft-delete it, assert both helpers stop
returning it *and* that the row survives in the table, then delete the fixture. Then I
deliberately broke both helpers with `perl -0pi` to watch it fail before I trusted it.

Two iterations: iteration 1 was schema → migration → seed → self-check, all of which went
green on the first attempt; iteration 2 was the lint/typecheck gate, which found two real
defects (below).

Beyond the task's own `## Verification`, the whole path was re-run from `docker compose down
-v` — destroyed volumes, `migrate deploy` into an empty database, seed, self-check, diff.
AC-1 literally says "on an empty database"; running it against the database I had been
iterating on all session would have proven something weaker than the claim.

### Friction

**The task file's Prisma block does not compile.** `ReportQuestion.question` had no opposite
relation field on `Question`, and `Answer` carried a `report_questions ReportQuestion[]`
back-relation to a foreign key that does not exist — the `db` spec's `report_questions` row
has exactly two FKs, `report_id` and `question_id`, and no `answer_id`. Prisma rejects both.
The spec was right and the task file's transcription of it was wrong; I moved the
back-relation from `Answer` to `Question`.

**`@@map` was missing from all 15 models**, which would have produced PascalCase tables
(`User`, `EmailToken`) and failed AC-1, which names all 15 in snake_case. This is the failure
mode the ledger warns about in the abstract — "a column name wrong here costs every downstream
module a rename migration" — arriving as table names instead of column names. Reading the `db`
spec rather than only the task file is what caught it; that is the whole reason the spec is
the contract and the task file is a summary.

**Three counts in the task's prose were stale** and would have made a careful reader think the
schema was wrong: "Cross-check: 14 models" (there are 15), "15 enums" (18), and the DoD's "all
five §8.1 indexes" (the spec's Indexes block lists seven). I trusted the generated SQL and the
spec, and recorded the correction rather than editing the counts to match whatever I produced.

**The verification's table count is off by one and always will be.** `information_schema.tables`
includes Prisma's `_prisma_migrations`, so the answer is 16, not the 15 the task predicts.
I ran the command exactly as written, reported 16, and ran the excluding variant alongside it
rather than quietly substituting a query that produced the expected number.

**Docker was not running** and `psql` is not installed on this machine. Started Docker Desktop;
ran every `psql` invocation inside the `db` container. Neither changed what was verified.

**Five files outside `backend/prisma` had to change**, which I did not expect from a schema
task, and every one was a latent break rather than scope creep:

- `compose.yaml` — `migrate` ran bare `npx prisma migrate deploy` with the image `WORKDIR` at
  the workspace root, so it found no schema. `docker compose up` on a fresh clone would have
  failed at the migrate step, which IDEA.md §10 calls the one unacceptable failure.
- `backend/Dockerfile` — no `prisma generate`, so `api`/`worker`/`migrate` would have shipped
  an empty `@prisma/client`.
- `eslint.config.js` — `eslint .` reaches `backend/prisma/seed.ts`, but the TS parser was
  scoped to `backend/src/**`, so `seed.ts` was parsed as plain JS: `Parsing error: Unexpected
  token {` on `import type`. Found by the gate, not by inspection.
- `tsconfig.json` — `include` did not cover `backend/prisma`, so `seed.ts` was never
  typechecked at all. A 400-line seed script outside the typechecker is a trap for whoever
  edits it next.
- `.env.example` — `SEED_ADMIN_PASSWORD`.

I verified the first two by actually building the image and running `docker compose run --rm
migrate`, rather than reasoning that the edit looked right.

**`npm test` does not exist at the root** (`npm error Missing script: "test"`) — the
pre-existing backlog gap. Reported as a skipped gate rather than silently passed over;
EXECUTE.md § 7 is explicit that a silently skipped gate is how a branch reaches CI red.

### What I rejected and rewrote by hand

**Prisma `^5`, as the task file specifies.** Rejected for 6.19.3 (ADR-F13). `npm audit
--audit-level=high` is a blocking CI job and Prisma 5 is two majors behind; nothing in the
spec uses a Prisma-5-only behaviour. I also rejected Prisma **7** — it replaces the
`prisma-client-js` generator the schema block assumes, and bundling a generator migration into
the task that authors the highest-blast-radius file is the wrong trade. Prisma 6 kept the
schema text byte-identical to what the spec dictates; the change is two version ranges.

**The self-check the task asked for.** "Calls `userInterviews` and `activeInterview` against
the seeded DB, printing counts" — printing counts cannot fail. Rewritten as the assert-based
probe described above. This is the single change I would defend hardest: the soft-delete leak
is called out in the spec's Security section as "a visible failure of a 5-point criterion if
it regresses", and it now has a check that regresses loudly.

**`personas/<id>/idle-placeholder.webp`**, the avatar key layout the task suggests. Rejected
for `personas/{personaId}/{state}-{sha256}.webp`, which is what `infra` §K12 and `ui` §3.6
actually pin. Seeding a key shape that infra would later have to migrate away from is a
self-inflicted rename.

**Importing `src/lib/env.ts` in `seed.ts`.** My first instinct, and it is what the repo
convention says ("`process.env` reads outside `env.ts` are a defect"). Rewritten to read
`process.env` directly with a comment explaining why: `env.ts` fails fast on the *service*
schema — `SESSION_SECRET`, `SMTP_HOST`, `MAIL_FROM` — none of which seeding touches, and
`npm run seed` should not require an SMTP host. The convention governs running services; a
seed is an ops tool. Recorded as a deliberate deviation rather than left as an unexplained
inconsistency.

**A dynamic `await import('node:assert')` in the self-check**, written to keep `assert` out of
the production path. `tsc` rejected it with seven `TS2775: Assertions require every name in the
call target to be declared with an explicit type annotation` errors — assertion functions need
an explicitly-typed declaration, and a destructured `const` from a dynamic import is not one.
Rewritten as a static `import { strict as assert } from 'node:assert'`, which is both correct
and shorter. `node:assert` is a builtin; the thing I was optimising away cost nothing.

**Hand-authoring `migration.sql`.** Never touched — `prisma migrate dev` generated it and I
audited the output (18 `CREATE TYPE`, 15 `CREATE TABLE`, 17 `ON DELETE RESTRICT`, zero
`ON DELETE CASCADE`) instead of writing it. The task file is explicit about this and it is the
right call: hand-edited migration SQL and a schema file drift apart silently.

**Bucket policy for the public prefixes.** Considered adding it while the seed already had an
S3 client in hand — 15 lines. Rejected: `infra` §7 owns the storage trust boundary, and
"adjacent work you noticed goes in the ledger's Backlog section, not in your diff". Backlogged
with the concrete symptom (`/assets/mascot/*.webp` returns 403 until it lands) so it is
actionable rather than a vague note.
