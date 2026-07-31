---
task: A03
author: Ahmet
sessions: [2026-07-31]
model: claude-opus-5[1m]
model_recommended: claude-sonnet-4.6
iterations: 3
tools: [superpowers:brainstorming, superpowers:test-driven-development]
---

## Session 1 — 2026-07-31

### What I asked for / what came back

`.agents/EXECUTE.md` as the prompt. § 4 selected A03 (A02 `done`, no row of mine
`in_progress`). § 5 then stopped the run: `MODELS.md` puts A03 at `claude-sonnet-4.6` and
this session is Opus 5, so the first output was

```
TIER A03 needs sonnet-tier, running claude-opus-5[1m]
```

The human overrode it and told me to run anyway. That is why `model` and
`model_recommended` disagree in the frontmatter above; per EXECUTE.md § Devlog they are
recorded as they actually were rather than quietly aligned. The tier call still looks right
in hindsight — the UI wiring was mechanical, and none of the session's difficulty was in it.

### Methodology trace

The component ring is this task's only test ring (no Cucumber scenarios exist for it), so
the ATDD ordering applies to the RTL tests:

```
task Step 8 + Definition of done
  → frontend/src/app/(auth)/{register,sign-in}/page.test.tsx   (12 tests)
  → red: "Failed to resolve import ./page"  — 2 files failed, 0 tests
  → implement lib/api.ts, lib/auth-redirect.ts, lib/use-error-message.ts,
    components/auth/credentials-form.tsx, the two pages, the layout
  → green: 12 passed
```

A module-not-found red proves the files run, not that the assertions bite, so I mutated two
invariants and re-ran rather than trusting the transition:

| Mutation | Expected casualty | Result |
|---|---|---|
| drop the `//`-prefix guard in `safeReturnPath` | the protocol-relative open-redirect test | `× ignores the off-site returnPath //evil.example/phish` |
| return the raw code instead of `t('UNKNOWN')` | the registry-fallback test | `× falls back to UNKNOWN for a code that is not in the registry` |

`2 failed | 10 passed`, both exactly the intended tests, then restored to `12 passed`.

Gates: `npm run lint`, `npm run -w frontend lint`, `npm run typecheck`, `npm test`
(58 tests, both projects), `npm run -w frontend build` — all clean.

### Friction

**The stack does not run, and that is what blocked the task.** I started `docker compose up
-d --build` early to have a target for the smoke, and it exposed three defects that no CI
job can see:

- `backend/tsconfig.json` and `worker/tsconfig.json` do not exist, so `build` fails
  (`TS5058`); both Dockerfiles swallow it with `|| true` and then `CMD` a `dist/index.js`
  that was never emitted.
- `web`'s healthcheck runs `curl`, absent from the image, so `web` is never healthy and
  `edge` — gated on `web` *and* `api` — never starts. Nothing listens on :80.
- Caddy has no `/auth/*` handler and `handle /api/*` does not strip the prefix, while the
  backend mounts at `/auth`. A02's `REDIRECT_URI` currently resolves to Next.js.

The `build` CI job passes because of the `|| true`; `compose-check` only validates YAML.
Neither ever starts a container, so a stack that cannot boot has been green since F03.

I reached for `superpowers:brainstorming` here rather than deciding alone, because the fix
lands in Sezai's F03 seat and EXECUTE.md § 8 forbids working another ledger. The human chose
"land A03, mark blocked", and told me to settle the API-prefix question from the ledgers
rather than by preference. Reading them decided it cleanly: F03's own task file, both
REFERENCE files and F01's next-intl matcher all name `/api/*` as the browser-facing prefix,
and nothing anywhere mounts the backend under `/api` — so the strip belongs at the edge
(`handle` → `handle_path`), and no backend route or acceptance-test URL has to move.

Smaller friction: the task's verification command is `--testPathPattern`, a Jest flag.
Vitest rejects it outright (`CACError: Unknown option --testPathPattern`). § 6.5 fixes the
command and moves the code, so `frontend/scripts/vitest-cli.mjs` translates the regex into
Vitest file filters. Also: `frontend/` is a `src/`-dir app, so every path in the task file's
Context block was off by one directory.

### What I rejected and rewrote by hand

- **`useEffect(() => setBannerCode(initialErrorCode), [initialErrorCode])`** — my first pass
  mirrored the `?error=` prop into state in an effect. `react-hooks/set-state-in-effect`
  caught it, and it was right: that is derive-state-from-props with a cascading render.
  Rewrote as `submitCode === undefined ? initialErrorCode : submitCode`, where `undefined`
  means "no submission has answered yet". The effect and the import went away, and the
  URL-borne banner now clears on submit as a consequence of the data model rather than a
  second `setState`.
- **A shared `min(10)` password rule on both forms.** Convenient, and wrong: an account
  whose password predates the rule would be locked out of its own sign-in form by
  client-side validation the API would have accepted. Split into `registerSchema` and
  `loginSchema`, with the length rule only on register.
- **`safeReturnPath` as `candidate.startsWith('/')`** — which waves through
  `//evil.example/phish`, since the browser reads a protocol-relative URL as off-site. Added
  the `//` and `/\` rejections and six hostile cases to `auth-redirect.test.ts`; the
  mutation run above confirms the test catches the regression.
- **Zod messages as English sentences.** The resolver wants a message string, and the
  obvious move is to put copy there — which would have made the client-side
  `PASSWORD_TOO_SHORT` a hard-coded English string sitting next to a carefully localised
  server-side one. Made the messages error *codes* instead, so both routes end at the same
  `t('errors.<CODE>')` lookup.
- **Asserting the English copy in tests.** Rewrote to import `messages/en.json` and assert
  `messages.errors.EMAIL_TAKEN`. Each error test additionally asserts the raw code is *not*
  in the DOM — the non-negotiable that the frontend never renders a code.
- **`vitest.config.ts`** was renamed to `.mts` after Vite warned it was parsing ESM as CJS
  on every run. Cosmetic, but a warning printed twice per `npm test` is noise CI inherits.

## Session 2 — 2026-07-31

### What I asked for / what came back

"Can you run it to see whether it works." Session 1 had marked A03 blocked on three F03
stack defects without ever having run the screens in a browser — the component ring was
green, but green unit tests are not a working page. So: stand the stack up by hand and
drive it.

The API, Postgres and Redis came up fine. `next dev` came up fine. Then every route 404'd.

### Methodology trace

Built the runtime bottom-up, checking each layer before adding the next, so a failure would
name its own cause:

```
db + cache (compose, host ports)     → prisma migrate deploy: "No pending migrations"
API on host (tsx)                    → SERVER_STARTED :4000, /healthz 200
next dev                             → :3000 up
GET :3000/sign-in                    → 307 → /en/sign-in → 404      ← defect found here
remove src/middleware.ts             → /, /sign-in, /register all 200
Caddy container, committed config
  + the one handle_path change       → /api/healthz 200 through the edge
full auth contract via curl          → 201 / 409 / 401 / 200 / 401, all correct codes
playwright smoke                     → 1 failed (429), then 2 passed after the config fix
screenshots + request counting       → short password: 0 API calls, inline message
```

The `/en/sign-in` 404 is the one that mattered. `next build` in session 1 listed the routes
as `/sign-in` and `/register`, which I read as confirmation the route map held — but build
output lists filesystem routes and says nothing about what middleware does to a request at
runtime. Every route in the app, `/` included, was a 404 in a browser, and had been since
F01. A build that lists a route is not a route that answers.

### Friction

The smoke's first run failed on `expected 201, received 429` inside `beforeAll`. My instinct
was to blame the rate limiter as environmental; it wasn't. Playwright workers are separate
processes and each runs the file's `beforeAll`, so two workers spent two of the three hourly
registrations on the fixture before a single test body ran. That is my bug, in a config I
wrote, and only running it could have surfaced it — the component ring cannot see a limiter
and `--list` cannot see a fixture.

The register limiter is 3/hr/IP, so the smoke is inherently once-per-hour-per-IP. I flushed
`ratelimit:*` between runs, which is exactly what A01's acceptance harness does between
scenarios. Whoever wires this into CI needs the same hook or an ephemeral Redis.

Screenshots were worth the detour: the fonts were visibly wrong in a way no assertion I had
written would ever have caught. Headings rendered in Outfit, everything else in the browser's
default serif, because `--font-body` was defined on `<html>` and then never applied to
anything. A CSS variable names a font; it does not use it.

### What I rejected and rewrote by hand

- **`fullyParallel: true` in `playwright.config.ts`.** Copied from the Playwright default
  scaffold without thinking about a fixture that spends a rate-limited resource. Rewrote to
  `workers: 1`, and gave the fixture's assertion a message that explains a 429 rather than
  letting it read as an app regression.
- **Leaving `src/middleware.ts` in place with `localePrefix: 'never'`.** My first idea, and
  wrong: next-intl's routing middleware rewrites to a `[locale]` segment in every prefix
  mode, and this app has none. The app is in *without i18n routing* mode, which takes no
  middleware at all. Removed the file instead of configuring it into a shape it cannot have.
- **Treating the 404 as A03's problem to route around.** It was tempting to special-case the
  auth routes in the matcher and move on, since only `/sign-in` and `/register` were in
  scope. But `/` was broken too, the cause was F01, and F01 is this ledger owner's — so the
  fix belonged upstream of A03, not inside it.
- **Calling the task done because the smoke went green.** It went green against a runtime I
  assembled by hand, not against `docker compose up`, which is what the Definition of done
  names. The row stays `blocked`; the run is recorded as evidence for the proposed F03 fix
  rather than as the verification it is not.
