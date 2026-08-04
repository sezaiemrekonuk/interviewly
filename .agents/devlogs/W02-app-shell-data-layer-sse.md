---
task: W02
author: Sezai
sessions: [2026-08-04]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 1
tools: []
---

## Session 1 — 2026-08-04

### What I asked for / what came back

EXECUTE.md § 3/§ 4 picked W02 (W01 `done`, deps F01/A01 `done`). Installed
`@tanstack/react-query@^5` into the frontend workspace, then wrote the two verification
suites first, saw them red (module not found), then the layer: `query.ts`,
`use-interview-events.ts`, `error-routing.ts`, `providers.tsx`, `locale-switcher.tsx`,
`lib/locales.ts`, `test/event-source-mock.ts`, `renderWithProviders`.

### Methodology trace

frontend spec §4.5 + K11 → `use-interview-events.test.ts` / `error-routing.test.ts` → red
(2 files, no tests collected) → green, 11 tests. Frontend ring 109, root ring 217, lint,
typecheck and `next build` clean.

### Friction

- Read `backend/modules/interview/sse.ts` before writing the hook: the server emits
  `event: INTERVIEW_STATE_CHANGED`, a **named** event, so an `onmessage`-only client (which
  the task file's wording invites) would have received nothing and the room would have sat
  stale. Registered both.
- `document.cookie = …` in the switcher tripped `react-hooks/immutability`; moved the write
  into `lib/locales.ts` as `writeLocaleCookie`, which also gave the client-safe home for
  `locales`/`Locale` (`i18n.ts` imports `next/headers`, so a client component cannot import
  the list from there).
- The switcher wrote a cookie nothing read: `i18n.ts` only consulted `requestLocale`, which is
  undefined without next-intl routing. Added the `NEXT_LOCALE` cookie fallback, otherwise the
  toggle would have looked wired and done nothing.

### What I rejected and rewrote by hand

- First `error-routing.ts` had `return router.replace('/not-found'), 'navigated'` — a comma
  operator smuggled in for brevity. Rewrote as two statements.
- Rejected a module-scope `queryClient` singleton (the obvious React Query snippet): on the
  server it is shared across requests, so one user's cached `/me` can render for another.
  `Providers` creates it in `useState` instead.
