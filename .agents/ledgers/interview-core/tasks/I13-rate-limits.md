# I13 — Rate limits: daily interview cap + interview-start limiter
REPO: (this repo) · Depends: I03, A01 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — wiring over the A01 Redis sliding-window limiter factory plus a rolling 24 h counter. No new trust boundary; the clock seam is the only subtlety.

## Goal
Owner's ask:

> "The daily interview cap (5 per rolling 24 h per user → `DAILY_INTERVIEW_LIMIT`), the
> interview-start limiter (10/hr per user → `RATE_LIMITED`), and confirm the auth sign-in
> (5/min) and register (3/hr) limiters A01 built are wired. Scenarios AC-12 and AC-13 in
> `rate_limits.feature` green."
> — interview-core decomposition (§7.4)

This task adds the daily-interview cap and the interview-start limiter to `POST /interviews`
(I03) and verifies the auth limiters. It reuses A01's Redis limiter factory and the single
Redis client — no new connection.

## Security boundaries
- **Counters are keyed by `user_id`** for interview limits (not IP), so a user cannot bypass
  the cap by rotating IPs. The auth limiters stay IP-keyed (A01).
- **Reuse the single Redis client** from A01/`env.ts`. Do not open a second connection.

## Non-negotiables
- **Daily cap:** the 6th interview within a rolling 24 h window per user → 429
  `DAILY_INTERVIEW_LIMIT`, no interview created; after the window rolls past, a new start is
  201 (`rate_limits.feature` @AC-12). Use the injected `Clock` so the fixed-clock scenario is
  deterministic.
- **Interview-start limiter:** the 11th start within the hour per user → 429 `RATE_LIMITED`;
  after the window, 201 (@AC-13, `interview-start`/`user-123` row).
- **Auth limiters confirmed wired:** sign-in 5/min per IP → `RATE_LIMITED`, register 3/hr per
  IP → `RATE_LIMITED` (@AC-13, `sign-in`/`register` rows). These are A01's middleware; this
  task confirms they are attached and covered by the acceptance run, adding the wiring if a
  route lacks it.

## Context (anchors)
- `backend/modules/interview/rate-limit.ts` — **create.** Two middlewares built on A01's
  factory: `interviewStartLimiter` (10/hr per `user_id`) and `dailyInterviewCap` (5 per
  rolling 24 h per `user_id`, → `DAILY_INTERVIEW_LIMIT`, log `DAILY_LIMIT_HIT`). Both use the
  injected `Clock`.
- `backend/modules/interview/setup.ts` — I03. Attach `dailyInterviewCap` then
  `interviewStartLimiter` at the marked slot before the handler.
- `backend/modules/auth/rate-limit.ts` — A01. Reuse the factory + the shared Redis client;
  do not reimplement sliding windows. Confirm `registerLimiter`/`loginLimiter` are attached
  to `/auth/register` and `/auth/login`.
- `backend/src/lib/env.ts` — F03. `config.REDIS_URL` (single client).
- `backend/src/lib/error-codes.ts` — F01. `DAILY_INTERVIEW_LIMIT`, `RATE_LIMITED`.

  **The trap:** the daily cap is a **rolling** 24 h window, not a calendar day. Count starts
  in the last 24 h from `clock.now()`; a fixed-clock advance past the oldest start's
  +24 h must free a slot. Do not reset at midnight.

## Steps
- [x] **1. Write `rate-limit.ts`** — `interviewStartLimiter` (10/hr/user) and
  `dailyInterviewCap` (5/rolling-24h/user → `DAILY_INTERVIEW_LIMIT`, `DAILY_LIMIT_HIT` log),
  both over the injected `Clock`, on A01's factory + shared Redis client.
- [x] **2. Attach both** to `POST /interviews` (I03) before the handler.
- [x] **3. Confirm the auth limiters** are attached to `/auth/register` and `/auth/login`;
  add wiring if missing (do not re-author the middleware).
- [x] **4. Wire acceptance step-defs** for `rate_limits.feature` @AC-12 (6th interview in 24 h
  → 429 `DAILY_INTERVIEW_LIMIT`, none created; window rolls → 201) and @AC-13 (sign-in 5,
  register 3, interview-start 10 → 429 `RATE_LIMITED`, then 200/201 after the window).
- [x] **5. Run the `## Verification` command.**

## Definition of done
- The 6th interview within a rolling 24 h window is 429 `DAILY_INTERVIEW_LIMIT` with none
  created; a window roll frees a slot.
- The interview-start (10/hr), sign-in (5/min) and register (3/hr) limiters each reject the
  over-window request with 429 `RATE_LIMITED` and allow it after the window.
- All limiters share the single Redis client; interview limits are keyed by `user_id`.

## Verification
```bash
npm run test:acceptance -- --tags "@rate-limits"
```

## Notes

**What exists now**

- `modules/auth/rate-limit.ts` — A01's private `limiter(prefix,limit,windowMs)` is now the
  exported `keyedLimiter({prefix,limit,windowMs,keyOf,code?,event?})`. `code` defaults to
  `RATE_LIMITED`, `event` to `RATE_LIMIT_HIT`; the log field is now `key`, not `ip`/`userId`.
  `registerLimiter`, `loginLimiter`, `passwordResetLimiter`, `profilePatchLimiter` all rebuilt
  on it (profilePatch lost its hand-rolled copy). `slidingWindowHit` is exported.
- **`slidingWindowHit` scores from `clock.now()`, not `Date.now()`** — the whole reason the
  @AC-12/@AC-13 window rolls are deterministic. Every limiter in the repo inherits this.
- `modules/interview/rate-limit.ts` — `dailyInterviewCap` (5 / rolling 24 h / `user_id` →
  `DAILY_INTERVIEW_LIMIT`, `DAILY_LIMIT_HIT`) and `interviewStartLimiter` (10/h / `user_id`).
- `modules/interview/router.ts:30` — `POST /` = `requireVerifiedEmail, dailyInterviewCap,
  interviewStartLimiter, setupInterview`. Auth limiters were already wired (step 3, no change).
- `features/step_definitions/rate-limits.steps.ts`; `rate_limits.feature` added to
  `cucumber.js` **default** profile (AiWorld — it needs HTTP + DB + Redis, all of which that
  ring has, and `server.ts`'s `Before` already resets `ratelimit:*`).

**Deviations, both deliberate**

- **@AC-13's `<key>` column is a label, not an assertion.** sign-in/register are IP-keyed and
  every acceptance request is loopback; honouring `203.0.113.10` needs `trust proxy` + a
  client-supplied `X-Forwarded-For`, i.e. a spoofable bypass of the limiter under test. Not
  added. If `trust proxy` ever lands for Caddy, revisit and assert the key.
- **@AC-13's interview-start row seeds its 10 hits via `slidingWindowHit` directly**, because
  the daily cap is 5 — 10 real starts would 429 as `DAILY_INTERVIEW_LIMIT` and never reach the
  hourly limiter. @AC-12 is what proves a real start increments a real counter.
- The counter records the attempt *before* the handler runs, so a start that fails validation
  still burns a daily slot (`ponytail:` comment marks it).

**Verification:** `npm run test:acceptance -- --tags "@rate-limits"` → 4 scenarios, 34 steps,
all passed. Red first, confirmed by unmounting both middlewares: 2 failed / 2 passed. Full
default ring 62/62, auth ring 23/23, 147 unit, lint + typecheck clean.

**For I14/I15:** new limiters go through `keyedLimiter`; do not hand-roll a zset.
