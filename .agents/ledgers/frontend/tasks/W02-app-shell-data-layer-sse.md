# W02 — App shell + React Query data layer + SSE hook + error-code→route map + locale switcher
REPO: (this repo) · Depends: F01, A01 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — the layer every screen trusts. The single-source-of-truth query key,
the nudge-then-refetch SSE seam, and the error-routing table carry the client-truth invariant
(K11, §4.5); a subtle bug here (render from an SSE payload, wrong invalidation key, a mis-routed
code) breaks the invariant for every screen built on it.

## Goal
Owner's ask:

> "The server-state data layer (React Query, no Redux — K11), the SSE nudge-then-refetch client
> (K11), and the error-code→locale-string mapping that keeps the API free of display strings
> (§4.5)."
> — frontend spec Scope; PLAN_FRONTEND_LEDGER.md §3 phase 1

This builds the shared foundation every later screen composes on: the `QueryClient` + provider,
the endpoint-shaped query-key factory, the `useInterviewEvents` SSE hook, the §4.5 error-code→route
table, and the EN/TR locale switcher. It renders no screen of its own — W03 is the first screen.

## Security boundaries
- **The room renders from the refetched state, never from an SSE payload** (K11, ADR-W02). The
  hook's contract is: an event arrives → invalidate `['interview',id,'state']` → the component
  re-renders from the refetch. The `{ type }` body is not read, not parsed, not passed on.
- **No raw error code reaches the DOM.** `error-routing.ts` decides *navigation*; display text
  still goes through `useErrorMessage` (A03) → `errors.<CODE>` → `errors.UNKNOWN` fallback.
- **Same-origin only.** Every request goes through `lib/api.ts`. This task adds no `fetch` with an
  absolute origin and reads no cookie from JS.

## Non-negotiables
- **React Query, no Redux** (ADR-W01). Query keys are exactly the K11 shapes: `['me']`,
  `['me','profile']`, `['me','interviews',{cursor}]`, `['interview',id,'state']`,
  `['interview',id]`, `['admin','interviews',filters]`, `['admin','stats',filters]`. Expose them
  through a factory so no screen spells a key by hand.
- **`['interview',id,'state']` is the single room truth.** The SSE hook invalidates exactly this
  key on every event and once on `open` after a reconnect; nothing else.
- **The SSE route is the real one** — `GET /interviews/:id/events` (ADR-W02), not the spec route
  map's `/events/interviews/:id`.
- **React Query retry policy:** retry/backoff on idempotent GETs only; **never** retry a mutation
  (a submit, a delete). A `409`/state error on a mutation invalidates `['interview',id,'state']`
  and lets the refetch resolve truth — no optimistic reconciliation (§ Data layer).
- **The locale switcher writes the locale cookie and re-renders UI copy + `errors.*` only.** It
  never touches `interviews.language` (§4.8 — the interview language is a separate axis).
- **Both locale files** carry every key this task introduces (ADR-W05).

## Non-negotiables — do NOT
- Do not build a Redux store, a context "app state" bag, or a global mutable cache beside React
  Query. Real client state (locale, in-room lifecycle) is `useState`/context; server state is
  React Query. Nothing else.
- Do not read or re-render the SSE event payload.

## Context (anchors)
- `frontend/package.json` — **modify.** Add `@tanstack/react-query` (dependency). Run `npm install`
  at the repo root so the workspace lockfile updates.
- `frontend/src/app/providers.tsx` — **create.** `'use client'`; a `QueryClientProvider` wrapping
  `children`, with the retry policy above set on `QueryClient` defaults.
- `frontend/src/app/layout.tsx` — **modify.** Mount `<Providers>` around the app; keep the existing
  `NextIntlClientProvider`/locale wiring and the CSP nonce (`middleware.ts`) intact.
- `frontend/src/lib/query.ts` — **create.** `queryClient` config + `queryKeys` factory (the seven
  K11 shapes) + thin typed hooks `useMe()`, `useInterviewState(id)` over `apiGet` (`lib/api.ts`).
- `frontend/src/lib/use-interview-events.ts` — **create.** `useInterviewEvents(id)`: one
  `EventSource(`/api/interviews/${id}/events`)`; `onmessage`/named events → 
  `queryClient.invalidateQueries({ queryKey: queryKeys.interviewState(id) })`; `onopen` after a
  reconnect → one invalidation; cleanup closes the stream on unmount. Payload ignored.
- `frontend/src/lib/error-routing.ts` — **create.** `routeForError(code, router, ctx)` implementing
  the REFERENCE §"Error-code → UI behaviour" table (UNAUTHENTICATED→sign-in preserving path via
  `signInPathFor`, FORBIDDEN→dashboard, INTERVIEW_NOT_FOUND→not-found, BUDGET_EXCEEDED→report-wait,
  EMAIL_NOT_VERIFIED→verify preserving the action, the two silent-refetch codes, the inline-only
  codes). Reuse `auth-redirect.ts`; add no new error code.
- `frontend/src/components/locale-switcher.tsx` — **create.** EN/TR toggle writing the locale
  cookie and refreshing; import `messages` keys, add a `common.locale*` namespace.
- `frontend/src/lib/api.ts`, `use-error-message.ts`, `auth-redirect.ts`, `use-require-auth.ts`
  (:A03) — reuse. Do not duplicate their logic.
- `frontend/src/test/render.tsx` (:A03) — **modify** if needed: the RTL harness may need to also
  wrap `QueryClientProvider` so screen tests can mount hooks. Add a `renderWithProviders` beside
  `renderWithIntl` rather than changing the existing signature.
- `frontend/messages/{en,tr}.json` — **modify.** Add `common.locale`, `common.localeEnglish`,
  `common.localeTurkish` (+ any nav shell copy) in both files.

  **The trap:** `EventSource` is not defined in jsdom. The hook's test (and every later room test)
  needs a mocked `EventSource` — build the mock as a reusable test util here
  (`src/test/event-source-mock.ts`) so W06/W07/W10 consume it instead of re-mocking. Assert: an
  emitted event triggers exactly one `invalidateQueries` for the state key, and a simulated
  reconnect (`open`) triggers exactly one more.

## Steps
- [ ] **1. Add `@tanstack/react-query`** to `frontend/package.json`; `npm install` at root.
- [ ] **2. `query.ts`** — `queryClient` (GET-only retry, no mutation retry) + `queryKeys` factory +
  `useMe`/`useInterviewState` typed over `apiGet`.
- [ ] **3. `providers.tsx` + mount in `layout.tsx`** — preserve locale + CSP nonce.
- [ ] **4. `use-interview-events.ts`** — one `EventSource` on the real events path, invalidate the
  state key on every event and once on reconnect `open`, close on unmount.
- [ ] **5. `error-routing.ts`** — the §4.5 code→route table over `auth-redirect.ts`; no new code.
- [ ] **6. `locale-switcher.tsx`** + `common.locale*` keys in both message files.
- [ ] **7. Test utils** — `src/test/event-source-mock.ts` and a `renderWithProviders`; unit-test the
  SSE hook (one invalidation per event, one on reconnect) and `routeForError` (each mapped code
  navigates where the table says, unmapped codes navigate nowhere).
- [ ] **8. Run the `## Verification` command.**

## Definition of done
- `useInterviewEvents(id)` opens one `EventSource` on `/api/interviews/:id/events`, invalidates
  only `['interview',id,'state']` on every event and once on reconnect, and closes on unmount —
  the event payload is never read.
- `routeForError` navigates each §4.5 code to its mapped destination (UNAUTHENTICATED→sign-in with
  return path, FORBIDDEN→dashboard, BUDGET_EXCEEDED→report-wait, …) and does nothing for an
  inline-only or unknown code.
- The locale switcher flips UI copy + `errors.*` and leaves any `interviews.language` untouched.
- `tr.json` carries every key `en.json` gained; no Redux/global-store code exists.

## Verification
```bash
npm run -w frontend test -- src/lib/use-interview-events.test.ts src/lib/error-routing.test.ts
```
Expected: the SSE hook and error-routing suites pass — one state-key invalidation per event and one
per reconnect; every mapped error code routes to its documented destination.

## Notes

(Empty until the task is done.)
