---
task: I04
author: Sezai
sessions: [2026-07-31]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 5
tools: [superpowers:brainstorming, superpowers:using-superpowers]
---

## Session 1 — 2026-07-31

### What I asked for / what came back

`EXECUTE.md` against my ledger. § 3 gave I04; § 5 tier matched (`MODELS.md` names
`claude-opus-4.8`, ran `claude-opus-4.8` — same tier, hence the frontmatter mismatch).

Best output of the reading phase was two conflicts caught before any code:

- **Timing.** ADR-I07 + backend spec §3 say the tech batch is "triggered after HR generation
  succeeds" = inside `POST /profile`. @AC-7 asserts tech is empty when that returns; @AC-1
  reconfigures the stub *after* profiling then triggers tech itself. Two scenarios, same
  direction, both against the prose.
- **Scope.** Verification `--tags "@profiling or …"` selects 4 scenarios; task step 5 scopes
  @AC-2 only, and the other two end at report generation (I09).

Used `superpowers:brainstorming`, put both forks to my human with a recommendation each rather
than guessing or blocking. Both taken → ADR-I22, ADR-I23.

### Methodology trace

```
§3.7 / AC-7  → question_generation.feature:17 → red (MODULE_NOT_FOUND generation)
                                              → red (RATE_LIMITED, register 3/hr per IP)
                                              → red (ambiguous step) → green
§3.3 / AC-2  → profiling.feature:3            → red → green
§3.3 / AC-3b → profiling.feature:30           → red → green (dob stripped, both casings)
ADR-I22      → question_generation.feature:33 → red → green
```

4 cycles. Verification 6 scenarios / 65 steps. Full suite 27/27 — closes I03's undefined-scenario
gap, so CI `acceptance` went blocking in the same run. lint/typecheck clean, 75 unit.

### Friction

- `.env` has live keys + `AI_ENABLED=true`; first task generating through the app's client, so a
  full run would have billed real OpenAI calls. `cucumber.js` now forces `AI_ENABLED=false`
  before `loadEnvFile`. Highest-value line in the diff, in no task file.
- `.env` uses compose hostnames — suite cannot run locally without overriding
  `DATABASE_URL`/`REDIS_URL`. I03 never hit it (one register per run).
- Register is 3/hour per IP, all scenarios from 127.0.0.1 → 4th sign-in 429s. Shared `Before`
  clears `ratelimit:*`.
- CI never runs `seed` (needs a bucket), but round creation needs `persona_id`. Same `Before`
  upserts them. Would have been green local / red CI.
- Two step phrases now serve two rings (`the HR round is generated`, `exactly N questions exist
  for the HR round`). One global step registry, so branching on `interviewId` was the only
  option; `the response status is {int}` set that precedent in I02.

### What I rejected and rewrote by hand

- **`setAiClient()` test seam** on `modules/ai` to swap the memoised singleton for @AC-1.
  Test-only code in a production module — and @AC-1 never claims HTTP, so `generateRound` takes
  an optional `client` instead and production has no seam.
- **`order_index: q.orderIndex`** from the batch → `i + 1`. Model-produced content; a repeated or
  skipped number collides `@@unique([round_id, order_index])` or holes the walk.
- **Round row created before the length check** — a rejected batch left an empty round. Moved
  into the insert transaction, after the check.
- **`hasProfile = Object.values(rest).some(v => v != null)`** — `{}` is not null, so an empty
  snapshot compiled to `{"account":{}}` instead of `no profile provided`, failing @AC-2's point
  silently. Key-count test, and `mergeProfile` omits absent halves.
- **`Prisma.JsonNull`** → `DbNull`. JsonNull stores the literal `null`; the column means absent.
- **Stripping only `dateOfBirth`** — specs disagree on casing (backend §8b vs db spec) and A06
  hasn't settled it. Both casings stripped, CV key too, unit test asserts both.

## Session 2 — 2026-07-31 — PR #12 CI

### What I asked for / what came back

`unit` and `build` red; everything else green. Unrelated causes.

- **`unit` — mine.** `profile.test.ts` tests a pure function but pulls
  `profile → generation → modules/ai → env.ts`, which `process.exit(1)`s at import on a missing
  key. `cp .env.example .env` was necessary but **inert**: Vitest's implicit dotenv was supplying
  the env locally, so any fix looked like it worked. Caught it by pointing the load at
  `.env.NOPE` and watching the suite still pass. Now
  `node --env-file-if-exists=.env node_modules/.bin/vitest run` — verified at the node level.
- **`build` — not mine, and not worker.** Skipping worker surfaced the identical error in `api`
  and `migrate`. Every image fails `tsc` on `Cannot find module 'zod'`: workspaces pin different
  zod versions so npm nests it at `backend/node_modules/zod`, and the build stage copies only
  `/app/node_modules`. Red on master since before I03; `ebb0ba1` is titled "fix(ci): skip worker"
  but its diff only touched `acceptance`. Fixed on my human's instruction (subagent): deps stage
  copies every workspace manifest, build stage does `COPY --from=deps /app ./`, all three
  Dockerfiles. Verified independently — `docker compose build` exit 0, four images, and
  `backend/node_modules/zod` present in `interviewly-api`. CI `build` blocking again.

### Methodology trace

```
unit  → hide .env → reproduced → cp .env.example .env → CI red again on same sha
      → point load at .env.NOPE → still passes locally → fix was inert
      → node --env-file-if-exists → verified with no Vite in the path
build → git show ebb0ba1 (touches acceptance only) → 3/3 prior master builds red
      → skip worker → api + migrate fail identically → not a worker problem
      → run deps stage alone → zod at backend/node_modules/zod, never copied forward
```

### Friction

- Shipping an unverified fix cost a full CI round trip. When a fix targets something that
  already passes locally, the only honest check is to break the fix on purpose.
- `fix(ci): skip worker` reads as "already fenced off"; master's run history was what settled it.

### What I rejected and rewrote by hand

- **`docker compose build || true` itself, twice over.** First I objected to it and split the
  step — sound reasoning, wrong premise, since `api` and `migrate` failed too and the split
  protected nothing. Then I shipped the blanket `|| true` as asked. Both are gone: the build is
  actually fixed, so the gate is back rather than disabled. Skipping a red gate was the wrong
  end of the problem the whole time.
- **"It's a worker problem"** — stated off one log where worker failed first. Should have read it
  as "zod unresolvable in every image".
- **`setupFiles` + a `vitest.config.mts` load** for the env fix: two mechanisms for one thing,
  neither guaranteed to run before the first module import the way node's flag is.
