---
task: A02
author: Ahmet
sessions: [2026-07-31]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 1
tools: [docker-compose, cucumber-js, tsx]
---

## Session 1 — 2026-07-31

### What I asked for / what came back

`EXECUTE.md` picked A02 (A01 `done`, tier opus, session opus — match). `MODELS.md` names
`claude-opus-4.8`; this session ran `claude-opus-4.8`. Same tier, so §5's stop condition did
not fire, and the two frontmatter keys are left disagreeing rather than quietly aligned.

The task file is unusually prescriptive — a numbered handler-by-handler sketch. Most of it
survived. Three parts did not, and all three are the same failure mode: the sketch was
written against an imagined API or an imagined threat model rather than the real one.

**arctic.** The sketch calls `await google.createAuthorizationURL(state, verifier, { scopes:
[...] })`. arctic 3.7.0's signature is synchronous and takes a bare `string[]`. The token
object is also methods, not properties — `tokens.accessToken()`. Reading
`node_modules/arctic/dist/providers/google.d.ts` before writing a line was worth more than
any amount of recalling how arctic used to look.

**Resolution order.** The sketch looks the user up by email, then applies the
`email_verified === true` gate. That is correct on the first sign-in and wrong on the
second: a Google-only account, created by this very flow, would face the gate again every
time and be 403'd the moment Google omitted the claim. Reordering to `google_sub` first
makes re-sign-in idempotent and weakens nothing, because a row can only *get* a
`google_sub` by passing the gate once. Recorded as ADR-A08.

**Where the errors go.** The sketch's step 8/9 redirect everything to `/sign-in?error=`;
its own Definition of Done says `OAUTH_STATE_MISMATCH` is *returned* as a 400. Both are
right for different audiences — a state mismatch is a tampered or stale callback, not a
user who needs a form back. Kept them split and wrote the split into REFERENCE and the A03
hand-off, since a frontend that expects one shape will silently mishandle the other.

### Methodology trace

`admin_auth.feature` was not in `cucumber.js` → `paths` and AC-5 still carried `@wip`, so
"red first" meant enabling the scenarios before writing any implementation:

IDEA §5.3 AC-4/AC-5 → `admin_auth.feature:4` + `auth.feature:38` → red
(`2 scenarios (2 undefined), 17 steps (7 undefined, 9 skipped)`) → `google.ts` +
`issueSessionForUser` + test seam + step definitions → green
(`2 scenarios (2 passed), 17 steps (17 passed)`) → regression
(`3 scenarios (3 passed), 26 steps (26 passed)`) → full suite
(`5 scenarios (5 passed), 43 steps (43 passed)`).

One red→green cycle. `tsc` caught one thing Cucumber could not: `z.unknown()` makes the key
optional, so the parsed userinfo did not satisfy a required `email_verified`. Fixed by
rebuilding the object field by field, which is better anyway — it makes "the claim was
absent" an explicit `undefined` rather than a missing property.

Two Definition-of-Done items have no scenario anywhere in `.agents/features/`: the shape of
the `/auth/google` redirect, and the four ways `OAUTH_STATE_MISMATCH` can happen. Wrote a
throwaway `tsx` script against a booted app for those and pasted its output verbatim into
the task `## Notes`. Kept out of the repo — it is evidence, not a test. Also confirmed
`mountTestSeam()` throws under `NODE_ENV=production` and that the seam route 404s there,
because "guarded at mount time" is a claim that deserves a run rather than a reading.

### Friction

**Node 20 + an ESM-only dependency.** arctic 3.x is `"type": "module"`; the acceptance
suite transpiles to CJS via `tsx/cjs`. This works only because Node 20.20 supports
`require(esm)`. It is a live constraint, not a detail — recorded in the task Notes.

**Local Postgres, again.** Homebrew Postgres owns `127.0.0.1:5432` and — new since A01 —
another Docker project owns `5433`. Landed on `5434/6380` via an uncommitted override.
Three sessions in, this has cost time every time; it belongs in a SETUP note eventually.

**The unit job is still a false green and I did not fix it.** EXECUTE §7 says the first
session to write a vitest test must drop `--passWithNoTests`. I wrote none, so the
obligation did not transfer — but not for lack of wanting to. `google.ts` transitively
imports `rate-limit.ts`, which opens an `ioredis` client at module load with
`maxRetriesPerRequest: null`; the `unit` CI job has no Redis service, so any unit test
touching auth would hang rather than fail. Making the client lazy is a `rate-limit.ts`
change with its own blast radius, and A02 is not the task for it. Filed in the ledger
Backlog with the trigger spelled out. Saying "no unit tests were needed" would have been
the comfortable lie here; the truth is they were blocked.

### What I rejected and rewrote by hand

**The task file's `issueSessionForUser`, twice.** Its body throws
`Object.assign(new Error(...), { code })` — a duck-typed error the app's error handler does
not recognise, since that handler tests `err instanceof ApiError`. As written it would have
produced a 500 `INTERNAL_ERROR` where AC-4 expects a 403, and the scenario asserts only
"no session cookie is set", so the wrong status could have survived a green suite. Rewrote
with `ApiError`. Its guard condition was also wrong in the anchors section —
`role === 'admin' && !user.password_hash` would let an admin *with* a password through the
Google flow, which is the exact bypass K8 exists to prevent. The `source` parameter further
down the same file is the correct model; used that.

**`redis.get` + `redis.del` for the PKCE verifier.** Wrote it as the sketch describes, then
replaced it with a single `GETDEL`. Two round trips leave a window where a replayed
callback reads a verifier that is about to be deleted. Single-use has to be atomic or it is
not single-use.

**A Zod boolean on the seam's `email_verified`.** My first cut was
`z.boolean()`, which is tidy and quietly removes the thing being tested — Zod would reject
`"true"` before `resolveGoogleIdentity` ever got to prove it treats it as unverified. Typed
it `unknown` end to end so the strict `=== true` is the only thing standing between a
truthy payload and a linked account.

**A vitest unit test for `startGoogle`.** Started one, then found the Redis-at-module-load
problem above and deleted it rather than ship a test that passes locally and hangs in CI.
