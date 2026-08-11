# T02 — The held partial: where an unfinished thought waits
REPO: (this repo) · Depends: F03, S03 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — the atomic take is the whole task. A `GET` followed by a separate
`DEL` passes every single-threaded test and double-submits a candidate's answer under
concurrency; a missing `questionId` check passes every test that does not span a question
boundary and joins a stale thought onto a new question. Both are silent, and both corrupt the
transcript the report is scored from.

## Goal
Somewhere to keep the words a candidate has already said but has not finished saying, for the few
seconds between one pause and the next. Server-side, under a key the client cannot influence,
with the loop counters inside it. No route touches it in this task — T03 wires it.

## Non-negotiables
- **The take is atomic.** `redis.multi().get(key).del(key).exec()`. Not `GET` then `DEL` — two
  uploads racing would both read the same partial and the candidate's sentence would be submitted
  twice, once joined onto each fragment. `GETDEL` also works but needs Redis ≥ 6.2; the MULTI
  form reads the same and works everywhere.
- **One Redis connection.** `import { redis } from '../auth/rate-limit'` — the same one `sse.ts`
  and `src/lib/probes.ts` use. Opening a second is a defect (`rate-limit.ts:8-10` says so).
- **The key is server-derived.** `interview:{interviewId}:pending-turn`, and `interviewId` comes
  from the route param **after** the ownership guard. No client-supplied component, ever.
- **The counters live in the value.** `probes` and the text length are what stop a client from
  holding a turn open forever. A counter the client sends is not a cap.
- **Nothing is logged but its shape.** Length and probe count, never the text (K6). It is
  candidate speech.
- **No in-memory fallback.** Redis unreachable means "no held partial" — the caller gates the
  fragment alone and forwards. Degraded, never stuck, and never a second source of truth.

## Context (anchors)
- `backend/modules/auth/rate-limit.ts:10` — `export const redis`, `ioredis`, and the comment
  forbidding a second connection.
- `backend/modules/auth/rate-limit.ts:16-28` — the existing `multi()...exec()` idiom, including
  how the result tuples are read (`results?.[2]?.[1]`). Copy that shape; `exec()` returns
  `[err, value]` pairs and typing it loosely is how a silent `null` gets through.
- `backend/src/lib/probes.ts:6` — the other importer, and proof the connection is shared.
- `backend/modules/interview/state.ts:25` `currentQuestionRow` — what a stored `questionId` is
  checked against by the callers in T03.
- `backend/src/lib/logger.ts` — structured logging; fields, not interpolated strings.

## Steps
- [ ] **1. Test red** — hold then take returns the value; a second take returns null; two takes
  racing yield exactly one non-null. See all three red. The concurrency one is the point of the
  task: write it so it genuinely interleaves rather than awaiting the first.
- [ ] **2. `backend/modules/speech/pending-turn.ts`** — the module, over the shared client.
  Exported constants `MAX_PROBES_PER_TURN = 8` and `MAX_PENDING_CHARS = 6_000`, so T03 imports
  the caps rather than restating them.
- [ ] **3. `takePendingTurn(interviewId)`** — atomic MULTI GET+DEL, JSON-parsed, returning
  `{ text, questionId, probes } | null`. A malformed value returns null and logs a warning with
  no content.
- [ ] **4. `holdPendingTurn(interviewId, value)`** — `SET` with `EX 300`. TTL on every write, not
  only the first.
- [ ] **5. `dropPendingTurn(interviewId)`** — plain `DEL`, for the callers that must discard
  rather than consume.
- [ ] **6. Redis-down behaviour** — every function swallows a connection error and behaves as
  "nothing held": `take` returns null, `hold` is a no-op, `drop` is a no-op. Each logs once. A
  throw here would turn a cache outage into a failed turn.
- [ ] **7. Unit tests** — round-trip, second-take-null, concurrent-take-once, TTL set on write,
  malformed value, Redis-down on all three functions, and no test fixture containing held text
  in a log assertion.

## Definition of done
- turn-taking AC-5 green (a held partial is consumed exactly once under concurrency).
- `takePendingTurn` is a single round trip; grep shows no `.get(` followed by a separate `.del(`
  on this key.
- Every function is total: no path throws to its caller.
- The TTL is set on every write.
- No log line carries held text.

## Verification
```bash
docker compose up -d cache
npm test -- --project node speech/pending-turn
npm run lint && npm run typecheck
```
Expected: green, with the concurrent-take test genuinely interleaving — confirm it fails if you
temporarily split the MULTI into a `get` and a `del`.

## Notes
_(fill in when done — T03 imports the caps and the three functions from here)_
