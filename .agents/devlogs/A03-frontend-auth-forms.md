---
task: A03
author: Ahmet
sessions: [2026-07-31]
model: claude-opus-5[1m]
model_recommended: claude-sonnet-4.6
iterations: 2
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
