# I05 — CSRF/origin enforcement on state-changing routes
REPO: (this repo) · Depends: I04 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — a CSRF control is a trust boundary; a weak or bypassable origin check is a cross-site state-change hole, and the "state unchanged on rejection" property is easy to get subtly wrong.

## Goal
Owner's ask:

> "Enforce the `Origin`/`Referer` == PUBLIC_ORIGIN check on every state-changing interview
> route so a cross-site `POST /interviews/:id/profile` is rejected with
> `CSRF_ORIGIN_MISMATCH` and leaves the state untouched, while a matching origin proceeds.
> Scenario AC-15 in `interview_flow.feature` green."
> — interview-core decomposition (§7.2, ADR-I14)

The CSRF middleware itself was written in I03 (`csrf.ts`) and attached to the router. This
task confirms it is applied to **every** state-changing interview route, verifies the
reject-before-handler ordering (a rejected request must not touch the state machine), and
lands the acceptance coverage through `/profile`. It adds no new endpoint.

## Security boundaries
- **The check runs before the handler.** `CSRF_ORIGIN_MISMATCH` (403) is returned before
  any state transition, DB write, or AI call. `interview_flow.feature` @AC-15 asserts the
  interview stays in `profiling` after a rejected `POST /profile`.
- **`Origin` first, `Referer` fallback, compared to `config.PUBLIC_ORIGIN`.** A missing both
  header on a state-changing route is a mismatch (reject) — do not fail open.
- **Every non-`GET` interview route is covered**: `/interviews`, `/interviews/:id/profile`,
  `/interviews/:id/answers`, `/interviews/:id/resume`. `GET` reads (`/state`, SSE,
  `/report/download`) are exempt (they change no state). Auth's own routes are exempt (they
  are the sign-in path, per ADR-I14).

## Non-negotiables
- **A mismatched `Origin` on `POST /interviews/:id/profile` → 403 `CSRF_ORIGIN_MISMATCH`,
  state stays `profiling`** (@AC-15). A matching origin → 200, state `hr_round`.
- **No route-by-route drift.** The middleware is applied once at the router level for all
  non-`GET` methods, not copy-pasted per handler — a per-handler application risks a missed
  route.

## Context (anchors)
- `backend/modules/interview/csrf.ts` — I03. The `requirePublicOrigin` middleware. Confirm
  the `Origin ?? Referer` resolution and the fail-closed behaviour on both-missing.
- `backend/modules/interview/router.ts` — I03/I04. Confirm `requirePublicOrigin` wraps every
  non-`GET` route. If any state-changing route added by I04 (`/profile`) or slotted for
  I06/I07 lacks it, add it at the router level.
- `backend/src/lib/env.ts` — F03/I15. `config.PUBLIC_ORIGIN` is the trusted origin.
- `backend/src/lib/error-codes.ts` — F01. `CSRF_ORIGIN_MISMATCH`.

  **The trap:** the SSE route and `/report/download` are `GET` and must stay exempt — adding
  the CSRF check to a `GET` breaks the room's event stream. Scope the middleware to
  state-changing methods only.

## Steps
- [x] **1. Audit the router** — every non-`GET` interview route is wrapped by
  `requirePublicOrigin`; `GET` routes are not.
- [x] **2. Confirm fail-closed** — both `Origin` and `Referer` absent on a state-changing
  route is a mismatch, not a pass.
- [x] **3. Confirm ordering** — the check precedes the ownership resolver's side effects and
  the handler; a rejection writes nothing and changes no state.
- [x] **4. Wire acceptance step-defs** for `interview_flow.feature` @AC-15 (evil origin →
  403 `CSRF_ORIGIN_MISMATCH`, state `profiling`; PUBLIC_ORIGIN → 200, state `hr_round`).
- [x] **5. Run the `## Verification` command.**

## Definition of done
- Every state-changing interview route rejects a non-PUBLIC_ORIGIN request with 403
  `CSRF_ORIGIN_MISMATCH` before any state change; `GET` routes are unaffected.
- `POST /interviews/:id/profile` with an evil `Origin` leaves the interview in `profiling`;
  with the public origin it proceeds to `hr_round`.

## Verification
```bash
npm run test:acceptance -- --tags "@interview-flow and @AC-15"
```

## Notes

### What exists now

- `csrf.ts` — `requirePublicOrigin` exempts `SAFE_METHODS` (`GET`/`HEAD`/`OPTIONS`) itself.
  That exemption is what makes router-wide mounting possible; everything else unchanged.
- `router.ts` — guard moved from two per-route positions to **one `router.use`, above
  `router.param('id', …)`**. Non-`GET` coverage is now automatic.
- `csrf.test.ts` (7 vitest) — GET exempt, Origin→Referer fallback compares `.origin` not the
  URL, both-absent and unparseable (`"null"`) fail closed, resolver not reached on reject.
- `csrf.steps.ts` + `httpPost(path, body, extra?)` in `world.ts` — @AC-15 green.

### Deviations from plan

- **Steps 1–3 were audits that failed.** The task read as assertion-only; it was not.
  Per-route wiring (`router.post('/', requirePublicOrigin, …)`) violated the non-negotiable,
  and `router.param` runs **before** route middleware in Express, so a cross-site POST hit
  `activeInterview()`'s DB read before the 403. Both fixed by the single `router.use`.
- **`@unwired` tag convention added** — see below. Owner-approved (Sezai), not in the task.

### `@unwired` — READ THIS BEFORE WIRING interview_flow.feature

`interview_flow.feature` is owned by four tasks. It is now in `cucumber.js` `paths`, and the
default profile carries `tags: 'not @unwired'`. Five scenarios are tagged `@unwired`:

| Scenario | Owner |
|---|---|
| @AC-8, @AC-9, @AC-10, @AC-16 | I06 (@AC-16 with I07) |
| @AC-11 | I08 |

**Your task DELETES its own `@unwired` tag in the PR that wires its step definitions.** Leave
it and your scenarios silently do not run — the same trap REFERENCE.md flags for `paths`.
`strict: true` still fails an untagged scenario whose steps are missing. A CLI `--tags`
replaces the profile expression, so every scoped Verification command is unaffected.

### For I06 / I07

- **Do not pass `requirePublicOrigin` to your route.** `router.use` already covers it; adding
  it again is the per-route drift the non-negotiable forbids. Mount plainly:
  `router.post('/:id/answers', submitAnswer)`.
- `GET /events/interviews/:id` (SSE, I07) is exempt by method, not by opt-out — safe wherever
  it mounts on this router.
- `httpPost` takes an optional third `extra` headers arg now.

### Verification output

```
npm run test:acceptance -- --tags "@interview-flow and @AC-15"
1 scenario (1 passed) · 8 steps (8 passed)
```

Gates: full acceptance 28/28 (was 27), `npm test` 82/82 (was 75), lint + typecheck clean.
Local run needs `DATABASE_URL=…@localhost:5432` and `REDIS_URL=redis://localhost:6380`.
