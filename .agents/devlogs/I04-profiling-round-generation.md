---
task: I04
author: Sezai
sessions: [2026-07-31]
model: claude-opus-5
model_recommended: claude-opus-4.8
iterations: 4
tools: [superpowers:brainstorming, superpowers:using-superpowers]
---

## Session 1 — 2026-07-31

### What I asked for / what came back

Asked for `EXECUTE.md` to be executed against my ledger. § 3's dependency graph put I04 first
(I02, I03 both `done`), § 5 put it on opus tier. `MODELS.md` recommends `claude-opus-4.8` and
this session ran on `claude-opus-5` — same tier, so § 5's tier gate passed; the two frontmatter
keys differ only because the ledger names a specific 4.x model and the tier is what the rule is
actually about.

The genuinely useful output of the reading phase was not code — it was catching that the task
file, ADR-I07 and the backend spec all disagree with the acceptance criteria about *when* the
technical batch is generated, before writing a line. ADR-I07 and backend spec §3 say the tech
batch is "triggered after HR generation succeeds", which reads as "inside `POST /profile`".
`question_generation.feature` @AC-7 asserts the technical round is empty when that request
returns, and @AC-1 reconfigures the stub *after* profiling and then triggers technical
generation itself — which only makes sense if nothing generated it already. Two independent
scenarios, same direction.

Second conflict, found the same way: the Verification command is
`--tags "@profiling or …"`, which selects all four `profiling.feature` scenarios, but the task
file's step 5 only scopes @AC-2 — and the other two end at report generation, which is I09.

I used `superpowers:brainstorming` for both, as the invocation asked, and put the two forks to
my human with a recommendation each rather than guessing or blocking. Both recommendations were
taken: acceptance criteria win over the prose (ADR-I22), and the report scenarios get asserted
at the ring that owns their criterion (ADR-I23), which is exactly the move ADR-I16 made in I01.

### Methodology trace

ATDD, feature files first, red before green:

```
spec §3.7 / AC-7 → question_generation.feature:17
  → red (MODULE_NOT_FOUND: modules/interview/generation)
  → red (RATE_LIMITED 429 — register is 3/hour per IP, six scenarios)
  → red (ambiguous step: "exactly N questions exist for the HR round")
  → green
spec §3.3 / AC-2 → profiling.feature:3   → red → green
spec §3.3 / AC-3b → profiling.feature:30 → red → green   (dob stripped, both casings)
ADR-I22        → question_generation.feature:33 (@AC-1) → red → green
```

Four red→green cycles. Verification: 6 scenarios / 65 steps. Full suite 27/27, 196 steps —
which closes the two-undefined-scenario gap I03 left behind, so I removed
`continue-on-error: true` from CI's `acceptance` job in the same run. `lint`, `typecheck` and
`vitest` (75 tests) all clean.

### Friction

- **The local `.env` has live provider keys and `AI_ENABLED=true`.** I04 is the first task whose
  scenarios generate through the app's own `AiClient`, so the first full run would have made
  real billed OpenAI calls and made every assertion non-deterministic. `cucumber.js` now sets
  `process.env.AI_ENABLED = 'false'` *before* `loadEnvFile` (whose semantics leave an
  already-set variable alone). This felt like the single highest-value line in the diff and it
  is not in any task file.
- **`.env` points at compose hostnames** (`db:5432`, `cache:6379`) which do not resolve from the
  host, so the suite cannot run locally without overriding `DATABASE_URL`/`REDIS_URL` to the
  published ports. I03 hit one register per run and never noticed. Written into I04's Notes and
  the STATE.md pointer so the next session does not lose ten minutes to it.
- **Registration is 3/hour per IP** and every scenario arrives from 127.0.0.1. The fourth
  sign-in in a run 429s for reasons unrelated to what it is testing. Fixed with a shared
  `Before` that clears `ratelimit:*` — the limiter stays the subject of `rate_limits.feature`
  and stops being ambient noise everywhere else.
- **CI never runs `npm run seed`** (the seed PUTs avatar objects and needs a bucket CI does not
  start), but round creation needs a `persona_id` from the seeded `personas` table. Same
  `Before` upserts the two rows on deterministic ids. Would have been a green local run and a
  red CI, which is the worst order to find it in.
- Two step phrases now serve two rings. `the HR round is generated` means the package seam in
  `security.feature` and `POST /profile` in `profiling.feature`; same for `exactly N questions
  exist for the HR round`. Cucumber has one global step registry, so branching on
  `this.interviewId` was the only option — and `the response status is {int}` had already set
  that precedent in I02, which made it feel less like a hack than it first read.

### What I rejected and rewrote by hand

- **A test seam on the AI client.** My first design for @AC-1 ("the stub returns 4 for a
  requested 5") was a `setAiClient()` export on `backend/modules/ai/index.ts` so a step could
  swap the memoised singleton. I threw it out: it is test-only code in a production module, and
  re-reading @AC-1 showed the scenario never claims to go over HTTP — "the response error code"
  is the module's `ApiError` mapped through the envelope. `generateRound` takes an optional
  `client` instead, the step passes a shortfall wrapper, and production has no seam in it.
- **Trusting the model's `orderIndex`.** I first mapped `order_index: q.orderIndex` straight
  from the batch. Rewrote it to `i + 1`: `orderIndex` is content the model produced, and a batch
  that repeats or skips a number would collide `@@unique([round_id, order_index])` or leave a
  hole the state walk falls into. Ours to count, not the model's.
- **Creating the round row before the length check.** The first draft created
  `interview_rounds` up front, so a rejected batch left an empty round behind. Moved inside the
  transaction that inserts the questions, after the check — "no rows handed back" should mean no
  rows at all.
- **`hasProfile = Object.values(rest).some(v => v != null)` in `profileVariables`.** Subtly
  wrong: an account layer of `{}` is not null, so an empty snapshot would have compiled to
  `{"account":{}}` instead of `no profile provided`, quietly failing @AC-2's whole point. Rewrote
  to a key-count test and made `mergeProfile` omit absent halves rather than store them as null,
  so the two halves of the rule agree.
- **`Prisma.JsonNull` for an absent profile.** Wrong null: it stores the JSON literal `null` in
  the column. `DbNull` is a NULL column, which is what `candidate_profile Json?` means and what
  `profileVariables` reads back as absent.
- **Stripping only `dateOfBirth`.** The specs disagree with themselves on casing — backend §8b
  says `dateOfBirth`, the db spec says `date_of_birth` — and A06 (which writes `users.profile`)
  has not landed to settle it. Both casings are stripped, for the CV key too, and the unit test
  asserts both. Cheap insurance against a task I do not own choosing the other one.
