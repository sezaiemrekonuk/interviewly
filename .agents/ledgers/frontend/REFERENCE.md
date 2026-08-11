# Frontend — REFERENCE (read this once, then you don't need to spelunk)

Single orientation doc for any agent executing a task in this ledger. It reflects the
`frontend/` layout as it exists after foundations F01 and auth A01–A05, and names the backend
endpoints each screen consumes (owned by other ledgers). Verified against the working tree and
the `frontend`/`ui`/`backend` specs on 2026-08-03. If reality diverges, trust the code and patch
this file.

## Workspace, commands, ports

`frontend/` is an npm workspace (`web` container, internal port 3000), served through the Caddy
edge (the only published port). The browser calls `/api/*` same-origin; the edge strips `/api`
and proxies to `api:3001`.

```bash
npm install                                       # root — installs the frontend workspace
npm run -w frontend dev                           # next dev
npm run -w frontend test                          # the component ring (vitest, jsdom)
npm run -w frontend test -- src/app/page.test.tsx # one file
npm run -w frontend test -- -t "renders the CTA"  # one test by name
npm run -w frontend lint                          # eslint
npm run -w frontend build                         # next build (checks the bundle budget)
npx playwright test                               # smokes against `docker compose up`
```

The component ring is Vitest + React Testing Library over a mocked `fetch` and a mocked
`EventSource` (ADR-W04). **Verification commands in this ledger use `vitest` file/name filters,
never Cucumber `--tags`.** `cucumber.js` is never edited by a frontend task.

## What already exists (do not rebuild)

The auth ledger (A03–A05) shipped the entry family and the shared client libs:

| Path | Ships | What it gives you |
|---|---|---|
| `src/lib/api.ts` | A03 | `apiGet<T>`/`apiPost<T>` → `ApiResult<T>` (`{ status, ok, data, code, payload }`); the `/api` prefix; `credentials: 'same-origin'`; reads `{ error: { code } }`; transport failure → `code: 'UNKNOWN'` |
| `src/lib/use-error-message.ts` | A03 | `useErrorMessage()` → `(code) => errors.<CODE>`, unknown → `errors.UNKNOWN`. **The only way a code becomes text.** |
| `src/lib/auth-redirect.ts` | A03 | `safeReturnPath` (open-redirect-safe), `signInPathFor`, `DEFAULT_LANDING_PATH` |
| `src/lib/use-require-auth.ts` | A03 | `useRequireAuth()` → `{ user, loading }`; on `UNAUTHENTICATED` redirects to `/sign-in` preserving the path. `SessionUser = { id, email, role, locale, emailVerifiedAt }` (A06 widens it) |
| `src/app/(auth)/…` | A03–A05 | register, sign-in, verify-email(+token), forgot-password, reset-password(+token) — screens 2–5, done |
| `src/app/(auth)/layout.tsx` + `layout.module.css` | A03 | the `--gradient-entry` ground + centred card shell for entry screens |
| `src/components/auth/…` | A03 | `credentials-form.tsx`, `google-button.tsx` |
| `src/test/render.tsx` | A03 | `renderWithIntl(ui)` (wraps `NextIntlClientProvider`, `en` messages) + re-exported `messages` so tests assert by key, not by copy |
| `src/middleware.ts` | (infra) | per-request CSP nonce (`x-nonce`); the app hydrates under `default-src 'self'` |
| `styles/tokens.css` | F01 | the `:root` token registry (W01 lints it). Note F01 **darkened** `--text-muted`/`--primary`/`--live` from the ui-spec values for the AA floor — W01 asserts the *shipped* values meet AA, not the spec literals |
| `messages/{en,tr}.json` | F01 | `common.*`, `auth.*`, and the full `errors.*` namespace in both locales |

**The test pattern** (copy it): `src/app/(auth)/sign-in/page.test.tsx` — `vi.mock('next/navigation')`,
`stubFetch(status, body)` via `vi.stubGlobal('fetch', …)`, `renderWithIntl(<Page/>)`, assert
`screen.findByText(messages.errors.CODE)` and `screen.queryByText(/CODE/)` is null (the raw code
never renders).

## What this ledger builds (new)

| Path | Task | What it does |
|---|---|---|
| `src/app/providers.tsx` | W02 | `QueryClientProvider` (+ `NextIntlClientProvider` if not already at root); mounted in `layout.tsx` |
| `src/lib/query.ts` | W02 | the `QueryClient` and the query-key factory (K11 shapes) |
| `src/lib/use-interview-events.ts` | W02 | one `EventSource` on `GET /interviews/:id/events` → invalidate the `['interview',id]` **prefix** (both the room's state key and W07's report read, ADR-W08) |
| `src/lib/error-routing.ts` | W02 | the §4.5 code→route table (`UNAUTHENTICATED`→sign-in, `FORBIDDEN`→dashboard, `BUDGET_EXCEEDED`→report-wait, `EMAIL_NOT_VERIFIED`→verify, …) |
| `src/components/locale-switcher.tsx` | W02 | EN/TR toggle writing the locale cookie; UI copy only, never `interviews.language` |
| `src/app/page.tsx` | W03 | landing (screen 1) — replaces the current 6-line stub |
| `src/components/mascot.tsx` | W03 | `<Mascot pose>` plain `<img>` + per-pose `<link rel="preload">`; `alt` from `mascot.*` |
| `src/components/avatar.tsx` | W06 | `<Avatar personaId state>` plain `<img>`, `idle` → placeholder fallback on error |
| `src/app/(onboarding)/onboarding/[step]/page.tsx` | W04 | screens 6–8 |
| `src/app/interviews/new/page.tsx` | W05 | setup (screen 9) |
| `src/app/interviews/[id]/room/page.tsx` | W06/W10 | interview room (screen 11) |
| `src/app/interviews/[id]/pre-join/page.tsx` | W09 | pre-join (screen 10) |
| `src/app/interviews/[id]/page.tsx` | W07 | report + transcript (screen 12); `useReport` + `useInterviewState`, `<ReportView>`/`<ReportWait>`, reused `<Transcript>` |
| `src/app/dashboard/page.tsx` | W08 | history (screen 13) |
| `src/app/admin/page.tsx` | W11 | admin list + stats (screen 14) |
| `src/app/[locale]/admin/interviews/[id]/page.tsx` | W12 | per-interview drill-down: summary, the report's `promptUuid`+`promptVersion` (US-28 rollback handle), the per-call `llm_calls` table, the US-29 event timeline. In-place not-authorized, never a redirect; `INTERVIEW_NOT_FOUND` is its own state |
| `src/components/admin/{filter-bar,call-table,user-table,session-table,queue-panel,audit-table}.tsx` | W12 | the five `Spec` sections made real, plus the shared filter bar |
| `src/components/admin/table.module.css` | W12 | the one table vocabulary all five admin tables read (renamed from `interview-table.module.css`) |

**Route note:** every page actually lives under `src/app/[locale]/…` (issue 91 — the locale is a
path segment); the paths above are written without it where they predate the move.

## The backend surface this ledger consumes (never re-decide a shape or a code)

All same-origin under `/api`. Shapes are quoted from the owning ledger's REFERENCE or the code;
if a shape is not yet built, the task's `Depends on` names it and the task stops.

| Method + Path | Success shape | Owner |
|---|---|---|
| `GET /me` | `{ user: { id, email, role, locale, emailVerifiedAt, onboardingCompletedAt, interviewCount } }` (last two from A06) | A01/A06 |
| `GET /me/profile` | `{ profile, onboardingCompletedAt, cvUploadId }` | A06 |
| `PATCH /me/profile` | `{ profile }` — body `{ step, fields }`, per-step Zod, merge-not-replace | A06 |
| `POST /me/profile/complete` | `{ onboardingCompletedAt }` — idempotent | A06 |
| `POST /uploads` (`kind=cv`\|`listing`) | `{ uploadId, … }` — ≤10 MB, PDF, magic-byte checked | A06 (cv) / I11 (listing) |
| `POST /interviews` | `{ interviewId, hrCount, techCount }` **only** — no occupation/language yet (STATE blocker) | I03 |
| `GET /interviews/:id/state` | `{ interviewId, state, mode, currentIndex, targetQuestionCount, endedReason, language, persona, currentQuestion, transcriptCursor }` | I03 |
| `POST /interviews/:id/profile` | pre-questions or `{ skip: true }` → `hr_round` | I04 |
| `POST /interviews/:id/answers` | body `{ questionId, transcript, inputMode: 'text'\|'widget'\|'voice' }` → `{ state, nextIndex }`; non-current → `409 QUESTION_NOT_CURRENT` | I06 |
| `POST /interviews/:id/resume` | `paused` → round | I07 |
| `GET /interviews/:id/events` | SSE `{ type }` events — **the real path** | I07 |
| `GET /interviews/:id` | `{ interviewId, state, report }` — thin; `transcript`/`endedReason` come from `/state` (ADR-W08) | R01 |
| `GET /me/interviews` | `{ items, nextCursor }`, deleted excluded; item = `{id,state,mode,occupation,endedReason,createdAt,startedAt,endedAt}` — **no score, no cost** | N01 |
| `DELETE /interviews/:id` | `204` (soft delete) | N01 |
| `GET /admin/interviews` | `{ items, nextCursor }` (deleted included, `deleted` flag, `totalTokens`, `costUsd`; plus `userEmail` and the row's own `budgetUsd` since N03–N05). Filters: `occupationCluster`, `state`, `userId` | N01 |
| `GET /admin/stats` | `{ averageDurationMs, completed, cutShort, unfinished, totalTokens, totalCostUsd, perModel[], perOccupation[], weakestQuestions[] }` — `totalCostUsd`/`perModel[]` aggregated in Postgres, never summed client-side | N02 (+N05) |
| `GET /admin/interviews/:id` | `{ interview, calls[], callsTruncated, events[] }` — `interview.report` carries `promptUuid`+`promptVersion`; a call row carries `units`/`unitKind` (`'second'` for voice) | N04 |
| `GET /admin/llm-calls` | `{ items, facets[], nextCursor }`; filters `provider`, `model`, `interviewId`. `facets` is the vocabulary the filter selects offer | N05 |
| `GET /admin/users` | `{ items, nextCursor }`; filters `role`, `q` | N05 |
| `GET /admin/sessions` | `{ items, nextCursor }`; filters `userId`, `active` | N05 |
| `GET /admin/audit` | `{ items, actions[], nextCursor }`; filters `action`, `actorUserId`, `subjectId`. `action` is a **dotted** name on the wire; the rows themselves are written by N03 | N05 |
| `GET /admin/queue` | `{ queues[], deadLetter[] }` — structurally one queue (the report queue); polled at 30 s | N05 |
| `POST /admin/interviews/:id/report/requeue` | mounted, **unused by the frontend** — see STATE backlog | N05 |

### Admin query keys and the shared URL builder (`lib/query.ts`, W11/W12)

`queryKeys` is the only place a key is written (AGENTS.md). W12 added six:

| Key | Hook | Notes |
|---|---|---|
| `['admin','interviews',id]` | `useAdminInterview(id, enabled)` | the drill-down; `id`, not a filter bag |
| `['admin','llm-calls',filters]` | `useAdminLlmCalls` | infinite, cursor |
| `['admin','users',filters]` | `useAdminUsers` | infinite, cursor |
| `['admin','sessions',filters]` | `useAdminSessions` | infinite, cursor |
| `['admin','audit',filters]` | `useAdminAudit` | infinite, cursor |
| `['admin','queue']` | `useAdminQueue` | 30 s `refetchInterval`, no filters |

- **The filters are IN the key.** A narrowed list is a different resource; one entry for both
  shows the previous filter's rows for a frame after every change.
- `adminQuery(path, filters, cursor)` builds every admin URL — empty values dropped, so an
  untouched control cannot narrow anything. Six hand-built query strings is how one of them
  sends `state=undefined`.
- `AdminFilters<K>` = the named facets **plus an index signature**, so one bag flows into both
  the key and the builder with no cast at the call site.
- `useAdminStats` takes **no** filters (`adminStats()`) — it is a platform aggregate.

**i18n trap:** next-intl cannot address a message key containing a dot. Audit actions arrive
dotted (`interview.soft_deleted`), so the tree stores `audit.action.interview_soft_deleted` and
lookup is `t.has(...replaceAll('.', '_'))` with the raw wire value as fallback. The same `t.has`
fallback covers `admin.state.*`. `src/i18n/messages.test.ts` walks keys by `split('.')`, so a
literal dot in a key breaks the parity check rather than the screen.

### Room-state shape (the single room truth — `GET /interviews/:id/state`)

```jsonc
{
  "interviewId": "…",
  "state": "hr_round",              // created|profiling|hr_round|tech_round|paused|evaluating|completed|failed|abandoned
  "mode": "text",                   // text | voice
  "currentIndex": 4,                // global 1..N (K2), NOT per-round order_index
  "targetQuestionCount": 8,
  "endedReason": null,              // completed|cut_short|budget_exhausted|time_exhausted|abandoned|error
  "language": "en",
  "persona": { "id": "…", "role": "…", "name": "…", "avatarState": "idle" } | null,  // the ACTIVE speaker only
  "personas": [{ "id": "…", "role": "hr", "name": "…", "roundType": "hr", "avatarSet": { "idle": "personas/…/idle-<sha>.webp" } }],  // both tiles, hr then tech (ADR-W06)
  "currentQuestion": { "id": "…", "text": "…", "kind": "text", "widget": null, "deliveredAt": "…" } | null,
  "transcript": [{ "questionId": "…", "question": "…", "answer": "…", "roundType": "hr" }],  // answered turns, global order (ADR-W06)
  "transcriptCursor": 3             // count of chat_messages == answered turns
}
```

- `persona` names the **one** live speaker; `personas` is the roster both tiles render from —
  never invent a second live speaker (§3.2, K2). `avatarSet` carries the content-addressed keys,
  so no screen guesses a sha (`<Avatar avatarSet state>`).
- `currentQuestion.widget` is `null` until the widget question kind is built (I04/I06 scope,
  currently always null — `state.ts`); when present it is
  `{ kind: 'mcq'|'ordering'|'code', options?, language? }`.
- `currentQuestion.deliveredAt` is the server-stamped `asked_at` — the client does not compute
  answer duration.

### Error-code → UI behaviour (§4.5, built in W02's `error-routing.ts`)

| Code(s) | Behaviour |
|---|---|
| `UNAUTHENTICATED` | redirect `/sign-in`, preserve return path (already in `use-require-auth.ts`) |
| `FORBIDDEN` | redirect `/dashboard`; admin routes render not-authorized |
| `INTERVIEW_NOT_FOUND` | not-found screen (existence not leaked) |
| `QUESTION_NOT_CURRENT`, `INVALID_STATE_TRANSITION` | silent `['interview',id,'state']` refetch, no toast |
| `BUDGET_EXCEEDED` | refetch → `evaluating` → report-wait |
| `RATE_LIMITED`, `DAILY_INTERVIEW_LIMIT` | inline localized message with retry context |
| `EMAIL_NOT_VERIFIED` | route `/verify-email`, preserve the attempted action (typed listing not lost) |
| `EMAIL_TOKEN_INVALID`/`EXPIRED` | inline on the screen with a *request a new link* action |
| `EMAIL_RESEND_COOLDOWN` | keep resend disabled, show remaining seconds from the response |
| any other | inline/toast `errors.<CODE>`; unknown → `errors.UNKNOWN`, never raw |

The full `errors.*` key list is in `messages/en.json` (F01) — it already carries every code above
plus the `AVATAR_*`/`MASCOT_*`/`CV_*` codes. The frontend adds **no** new error code.

## Tokens, poses, budgets (from `ui.md` — bind by name, never by literal)

- **Colour:** `--primary` (`#C94D00` shipped) is the only CTA; `--accent` is never a CTA; `--live`
  is room-only (`LIVE` badge + active-speaker ring). Ground: `--gradient-entry` on the closed
  entry route list (landing, register, sign-in, verify, forgot/reset, onboarding×3, setup,
  pre-join) and **nowhere else**; room/report/dashboard/admin are flat `--bg`.
- **Type scale (px):** exactly `13/14/16/20/28/40/56` — `56` is the landing/onboarding hero.
- **Shadow:** `--shadow-soft` on entry surfaces/cards only; everything else and everything in the
  room is limited to `--shadow-hairline`.
- **Radius:** panel `24` / card `16` / input `12` / button `999`. **Spacing:** multiples of 4.
- **Motion:** `150–250 ms ease-out` (`--duration-default`/`--easing-default`); near-zero in the
  room; instant under `prefers-reduced-motion`.
- **Fonts:** Outfit (headings) + Inter (body), self-hosted `next/font`, no external font origin.
- **`MascotPose`:** `wave` (landing/register/sign-in) · `point` (setup, onboarding 1) · `think`
  (verify, onboarding 2) · `cheer` (onboarding 3/complete) · `shrug` (empty/error). Key layout
  `mascot/{pose}-{sha256}.webp`, ~40 KB/image, ~200 KB/set, public-read, **preload only the pose
  the screen uses**. Excluded from room/report/admin (a mascot there is a defect).
- **`AvatarState`:** `idle|listening|thinking|speaking|acknowledging`. Key layout
  `personas/{personaId}/{state}-{sha256}.webp`, ~60 KB/image, ~350 KB/set, public-read, **preload
  both personas' full sets during the waiting beat**. Plain `<img>`, not `next/image`.

### Client-driven avatar state machine (text mode, W06 — §3.8)

`persona.avatarState` from room-state is the sync value on every refetch; between refetches the
lifecycle drives it: awaiting next question → `thinking`; question mid-animation → `speaking`;
question shown, awaiting input → `listening`; just after a submit → `acknowledging`; nothing in
flight → `idle`. Typed-question animation is 40 chars/sec; instant under `prefers-reduced-motion`.

## Budgets (assert where the spec gives a number)

- Landing LCP **< 2.5 s**, initial JS **< 250 KB gzip** (§8.1) — server component, no client data
  fetch, preload only the `wave` pose.
- Report ready **< 60 s** (§8.1) — the report-wait SSE-primary / bounded-poll path.
- Avatar ~60 KB/image, ~350 KB/set; mascot ~40 KB/image, ~200 KB/set (W01 asserts these against
  the seeded objects).
