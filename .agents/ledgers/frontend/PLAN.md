# Frontend — PLAN (Architecture)

Written once. Amend only via a new `DECISIONS.md` ADR-W entry referenced here.
Codebase orientation: `REFERENCE.md` (read that before touching any task).

Owner: **Sezai** (EXECUTE.md §1). Prefix `W` (web). Derives from
`.agents/specs/2026-07-29-frontend.md` (route map, per-screen behaviour, 26 ACs) and
`.agents/specs/2026-07-29-ui.md` (tokens, `AvatarState`/`MascotPose`, asset budgets, the
17 build/seed ACs this ledger absorbs — see ADR-W03).

## Goal

Build the Next.js `web` app: the demoable candidate path end to end in a browser —
land → register/sign-in → onboarding → set up an interview → answer questions in the room
→ see the report → find it again in history — then the surfaces that hang off it (voice
room, admin). When it ships, a signed-in candidate composes every screen the frontend spec
pins, over the React-Query data layer and the SSE nudge-then-refetch client, dressed in the
`ui` tokens, in English or Turkish. The auth family (screens 2–5) already shipped in the
auth ledger (A03–A05); this ledger builds the other 8 route groups and the shared shell,
data layer and asset primitives they compose on.

`docker compose up` → land → sign in → onboard → set up → answer through in text mode →
**see the rendered report** is the observable end-to-end result. That path closes at **W07**.

## The invariant this initiative must not weaken

> The client never owns interview truth or a display string. `['interview', id, 'state']`
> refetched from the API is the sole room truth — every SSE event and every reconnect only
> *nudges* a refetch and the event payload is ignored; every API error is a registry `code`
> mapped to a localized `errors.<CODE>`, never rendered raw; no server- or LLM-originated
> string is ever passed to `dangerouslySetInnerHTML`; the `httpOnly` session cookie is never
> read from JavaScript. (K11, §4.5, frontend spec Security)

A regression that renders a room from an SSE payload instead of a refetch, leaks a raw error
code into the DOM, `dangerouslySetInnerHTML`s a question/report/transcript string, or reads a
token from client storage is a scope-stop, not a feature gap. This ledger touches only
`frontend/`, plus one dependency add (`@tanstack/react-query`, and `recharts` at W11). It does
**not** touch any backend route, the error-code registry (F01 owns it; this ledger consumes
`errors.*`), the token registry (`ui`/F01 owns it), or any server-side behaviour.

## Topology

```
Browser
  │  Server components fetch INTERNAL_API_URL (SSR); browser fetches same-origin /api/* (§11.3)
  ▼
edge/ (Caddy — strips /api, single published port, F03)
  ▼
frontend/ (Next.js App Router, `web` container)
  src/app/
    layout.tsx                 ← root: <Providers> (React Query) + locale + CSP nonce (F01)
    page.tsx                   ← W03 landing (screen 1), server component, no data fetch
    (auth)/…                   ← A03–A05, SHIPPED (register, sign-in, verify, reset)
    (onboarding)/onboarding/[step]/  ← W04 (screens 6–8)
    interviews/new/            ← W05 setup (screen 9)
    interviews/[id]/pre-join/  ← W09 pre-join (screen 10, voice)
    interviews/[id]/room/      ← W06 text room + W10 voice room (screen 11)
    interviews/[id]/           ← W07 report + transcript (screen 12)
    dashboard/                 ← W08 history (screen 13)
    admin/                     ← W11 list + stats (screen 14)
  src/lib/
    api.ts                     ← SHIPPED (A03): apiGet/apiPost, /api prefix, error-code read
    auth-redirect.ts           ← SHIPPED (A03): safeReturnPath, signInPathFor
    use-require-auth.ts        ← SHIPPED (A03): UNAUTHENTICATED → /sign-in
    use-error-message.ts       ← SHIPPED (A03): code → errors.<CODE>
    query.ts                   ← W02: QueryClient + query-key factory (K11)
    use-interview-events.ts    ← W02: one EventSource → invalidate ['interview',id,'state']
    error-routing.ts           ← W02: the §4.5 code→route table (FORBIDDEN, BUDGET_EXCEEDED…)
  src/components/
    mascot.tsx                 ← W03: <Mascot pose> + per-pose <link rel=preload>
    avatar.tsx                 ← W06: <Avatar personaId state> plain <img>, idle fallback
  styles/tokens.css            ← SHIPPED (F01): the :root token registry W01 lints
  messages/{en,tr}.json        ← F01 seeded errors.*; each W task adds its screen namespace

Backend it consumes (never re-decides a shape or a code):
  GET  /me                          A01 (+A06 fields onboardingCompletedAt, interviewCount)
  GET/PATCH /me/profile, POST /me/profile/complete   A06
  POST /uploads (kind=cv A06 | kind=listing I11)
  POST /interviews, GET /interviews/:id/state        I03
  POST /interviews/:id/profile                       I04
  POST /interviews/:id/answers, /resume              I06/I07
  GET  /interviews/:id/events   (SSE — REAL path, ADR-W02)   I07
  GET  /interviews/:id          (report+transcript read)     R01 (see ADR-W07 — handler unowned)
  GET  /me/interviews, DELETE /interviews/:id                N01
  GET  /admin/interviews, /admin/stats                       N01/N02
  Voice mint + webhooks                                      V02/V05
```

## Decision table (full ADRs in DECISIONS.md)

| # | Decision | Chosen | Reason |
|---|----------|--------|--------|
| ADR-W01 | Server state | React Query, no Redux; `['interview',id,'state']` is the single room truth | K11 — spec-mandated; real client state (`locale`, in-room lifecycle) is `useState`/context only |
| ADR-W02 | SSE client | Native `EventSource` on the **real** route `GET /interviews/:id/events`; on any event → invalidate `['interview',id,'state']`, payload ignored; native reconnect + one invalidate on `open` | K11; the frontend spec route map's `/events/interviews/:id` disagrees with the implemented path (`backend/modules/interview/router.ts:33`) — code wins |
| ADR-W03 | `ui` build/seed checks | Folded into **W01**, no separate `ui` ledger | Prompt §2 — a token-lint/contrast/asset-budget Vitest suite is one task, not a ledger of ceremony |
| ADR-W04 | Verification ring | Vitest + React Testing Library (mocked API + mocked `EventSource`) and a handful of Playwright smokes; **not** Cucumber; `cucumber.js` is never touched | `COVERAGE.md` puts all 26 frontend + 17 ui ACs out of the acceptance ring; the repo has `frontend/vitest.config.mts` and root `@playwright/test` wired |
| ADR-W05 | i18n | Every screen ships `en` + `tr` keys in its own namespace; `messages/en.json` is the source, `tr.json` mirrors keys; LLM content is rendered in the interview language, never through `next-intl` | §4.5; owner decision (EN+TR from day one) |
| ADR-W06 | Sweeper & voice phasing | The 24 h `abandoned` sweeper is **not** here — it is report **R04** (a `worker` job, appended to the report ledger). The voice room is a real gated phase (the final demo uses voice), built after text mode so a working demo always exists | Prompt §2/§6.2; owner decision |
| ADR-W07 | Report read dependency | W07 depends on **R01** (which serves the ready report at `GET /interviews/:id`). The `GET /interviews/:id` handler itself is owned by no task — R01's DoD assumes it. Flagged, not planned around | Prompt §5 — do not plan a frontend task against a phantom route without naming the gap; see STATE.md blockers |

## Data model additions

**None.** This ledger writes no schema, no migration, no backend route. It adds two npm
dependencies (`@tanstack/react-query` in W02; `recharts` in W11) and one Next dependency
already present (`next-intl`). Every value it renders comes from an endpoint another ledger
owns or from the `ui` token registry F01 shipped.

## Phasing / task clusters (see STATE.md ledger)

1. **Foundation** (W01–W03) — ui build/seed checks; app shell + React Query data layer + SSE
   hook + error-routing + locale switcher; landing + mascot primitive. Everything composes on it.
2. **Onboarding + setup** (W04–W05) — the onboarding cards and the Jotform-shaped setup screen;
   the destinations `auth-redirect.ts` first-run routing already points at.
3. **Room, text mode** (W06) — the demoable core; two persona tiles, the client avatar state
   machine, typed-question animation, guarded answer submit, round handover, report-wait.
4. **Report + history** (W07–W08) — the report/transcript render and the dashboard; closes the
   loop. **W07 closes the demo path.**
5. **Voice** (W09–W10) — pre-join device check and the voice room surface; gated on the voice
   ledger (V02/V05). The final demo uses voice; text mode (phase 3) is what guarantees a demo if
   voice slips.
6. **Admin** (W11) — the admin list + Recharts stats surface; off the candidate demo path.

## Out of scope (backlog rows in STATE.md, unnumbered)

- **Admin per-call cost detail** (`/admin/interviews/:id`, US-26/29) — its backend endpoint is
  unowned (admin ledger Backlog, `admin/STATE.md:113`). Promote to a `W` task once Fatih numbers
  `GET /admin/interviews/:id` in the admin ledger.
- **Rich admin filters** beyond the list's cluster/state/user columns.
- **Adaptive candidate-analysis view** (`adaptive/PLAN.md:118`) — adaptive ledger.
- **Real illustrated avatar/mascot artwork** — the F02-seeded placeholders (34-byte 1×1 WebP)
  are enough for the PoC; swapping bytes at content-addressed keys needs no task.
- **The Download-PDF button beyond reserving its slot** (US-24) — the PDF is worker/R02.
