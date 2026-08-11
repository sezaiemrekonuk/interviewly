# Frontend — State

**Superseded below (2026-08-11, additionals ADR-ADD02):** the W09 row's "no camera preview" and
the W10 row's "**No self-camera**" are no longer true. Pre-join has a camera panel and the room's
candidate tile has a self-view, both off by default and both local-only, and the persona tiles
draw `change_avatar`'s expressions. No `W` task was opened or renumbered for it — the work is
recorded in `.agents/ledgers/additionals/`.

Last updated: 2026-08-11
Last session ended: **W12 done — the frontend ledger is green (W01–W12).** All eight `/admin`
sections now have an endpoint; `SpecPanel`/`admin.spec.*`/`admin.scope` are gone. `query.ts`
gained six keys, `adminQuery(path, filters, cursor)` and `AdminFilters<K>` (index signature —
one bag flows into key and URL with no cast). **Filters are IN the query key**, **one bag per
section** (shared state carried `state=completed` into the audit trail), and every hook is
`enabled` per section, so the console opens on two requests not eight. `/admin/interviews/:id`
is a real route — it is a link target from the table, the dead letter and the audit trail;
sections stay client state (ADR-W10). **Recharts rejected, `Meter` stands (ADR-W09):** the CSP
drops inline styles, so its charts render empty in production and green in jsdom.

Previous: **W11 done.** `/admin` renders
`StatsPanel` + `InterviewTable`; `useAdminInterviews(enabled)`/`useAdminStats(enabled)` gate on
`role === 'admin'` so a non-admin issues **no** `/admin/*` request, and a `FORBIDDEN` from either
read still renders the same not-authorized card in place (never a redirect). Recharts series colour
lives in `stats-panel.module.css`, not in props — presentation attributes lose to stylesheet rules,
which keeps `--primary` and hex literals out of the `.tsx`. Charts are `aria-hidden`; the legend
lists carry every number as text. `src/test/setup.ts` gained a no-op `ResizeObserver` (jsdom has
none; `ResponsiveContainer` needs one). Ring: frontend 238, root 359.

Earlier: **W10 done — voice is a branch in `room/page.tsx` on `room.mode`, not a second
room.** `useVoiceSession` (`src/lib/use-voice-session.ts`) mints via V02, opens `WebSocket(wssOrigin)`
and sends the token in the **init frame, never the URL** (K6: query strings reach proxy logs). It
emits a local `beat` only — `BEAT_BY_FRAME` maps agent frames to `speaking|listening|acknowledging`,
and the test proves a `user_transcript` frame moves the avatar while index/transcript stay put until
`/state` is refetched (K11). Mint refusal → `lost` + resync; **V03 already downgraded server-side**,
so the client never calls `voiceDowngrade` here. **V05's `createActiveSpeaker` is deliberately
unused** — the active tile is `persona.id` from the server, and deriving it from round state
client-side is the same K11 violation one layer down. **No self-camera** despite this row's title
(W09 established mic-only). `useMicPermission` gained `muted`/`toggleMute` (track disabled, not
dropped), `Transcript` a `live` prop, `QuestionPanel` an `instant` prop. New shared helper
`src/test/websocket-mock.ts`. Ring: frontend 231, root 352.

Earlier: **W09 done — `/interviews/:id/pre-join` is mic-only.** No camera preview (task
security boundary; "camera off-by-default" is satisfied by never asking). `useMicPermission`
(`src/lib/use-mic-permission.ts`) owns `idle|prompt|granted|denied|unavailable` + RMS level +
device list; `NotFoundError`/`OverconstrainedError` → `unavailable` (no retry, CTA removed), else
`denied` (retry + numbered recovery). Track release on unmount asserted in both suites.
`mode !== 'voice'` → `router.replace(room)` **before** any `getUserMedia`. **Fixed en route:**
`lib/query.ts` had a duplicate `useDeleteInterview` export (committed at 483797b) that broke every
rolldown import of the module — second copy deleted.

Earlier: **W08 done — history lives on `/`, not `/dashboard`** (owner-directed; no
`/dashboard` route exists). `home-switch.tsx` probes `GET /me` with plain `apiGet` (the
`header-nav.tsx` pattern) and `React.lazy`s in `authed-home.tsx`, so the anonymous landing keeps
its zero-React-Query budget (asserted in `src/app/page.test.tsx`). `/` is in the closed
`ENTRY_ROUTES` → entry ground + `--shadow-soft`, **not** the task file's flat `--bg`. Delete is
**not** optimistic (task file's Non-negotiables beat this file's old row title): invalidate
`['me','interviews']`, row goes on the refetch. `useMyInterviews`/`useDeleteInterview` + `apiDelete`
now live in `lib/query.ts`/`lib/api.ts` — W09/W11 reuse them. Ring: frontend 216.

Before that: **W07 done — the demo path is closed** (land → … → room → **report**).
`/interviews/:id` reads **two** endpoints (ADR-W08): `GET /interviews/:id` is thin
(`{interviewId,state,report}`), so `transcript` + `endedReason` come from room-state — `get.ts` was
not patched, it is another ledger's file. **`useInterviewEvents` now invalidates the
`['interview',id]` prefix**, not the state key, so one nudge covers both reads; the room is
unaffected and its `queryKey` param sketch was dropped. `ReportPayload` is **snake_case verbatim**
(`overall_score` int 0..100, `improvements` not "gaps") per `packages/ai/src/schemas.ts`. Poll
fallback = `useReport(id, poll)` 5 s, off at `<ReportWait onTimeout>`'s 60 s ceiling.
Ring: frontend 170, root 280.

And before: **W06 done.** `/interviews/:id/room` renders text mode off `['interview',id,'state']`
only; SSE is a nudge. **Room-state was extended to make that possible (ADR-W06):** `persona.id`,
`personas[]` (both tiles, each with `avatarSet`) and `transcript[]` ship from
`backend/modules/interview/state.ts` — W09/W10 read them, do not re-derive. `<Avatar>` takes the
`avatarSet` keys, never a client-guessed sha. Silent-refetch codes live once in `error-routing.ts`
(`SILENT_REFETCH_CODES`), reused by `useSubmitAnswer`.

## Execution protocol (follow exactly)

Do not start from this file. `.agents/EXECUTE.md` is the prompt, and its § 4 decides which
task is yours — not the "Current task" pointer below, which is a human-readable summary and
can lag.

Read this file → read `REFERENCE.md` once → read only the task § 4 gave you →
check `MODELS.md` for the required tier and stop if it is not yours → do the work, ticking
checkboxes → run the task's `## Verification` command verbatim → fill in the task's
`## Notes` → update this file's ledger row, "Current task" pointer, and "Last session ended"
line → write `.agents/devlogs/{ID}-<slug>.md` (EXECUTE.md § Devlog) → **do not commit** →
re-apply EXECUTE.md § 4 and continue with what it gives you.

## Current task

**None — every row W01–W12 is `done`.** The ledger is green. New frontend work needs a numbered
task first (`update-initiative`); the Backlog below is where the candidates sit.

## Environment

The cross-ledger tasks below must be `done` before the frontend task that depends on them
starts (per-task `Depends on` in the ledger table). Foundations first:

- **F01** provides `frontend/styles/tokens.css` (the `:root` token registry W01 lints),
  `frontend/messages/{en,tr}.json` (the seeded `errors.*` namespace), `@interviewly/types`,
  and the `AvatarState`/`MascotPose` type unions.
- **F02** provides `backend/prisma/seed.ts` — the seeded `personas.avatar_set` and mascot
  objects W01 validates (placeholder 34-byte WebPs are fine for the PoC; W01 checks
  completeness, budgets and content-hash keys, not artwork).
- **A01** provides `GET /me`, the session cookie, `requireAuth`, and (already shipped in A03)
  `frontend/src/lib/{api,auth-redirect,use-require-auth,use-error-message}.ts`.
- **A06** provides `GET/PATCH /me/profile`, `POST /me/profile/complete`, the `kind='cv'` path
  on `POST /uploads`, and the extended `GET /me` fields (`onboardingCompletedAt`,
  `interviewCount`) that first-run routing reads.
- **I03/I04/I06/I07** provide `POST /interviews`, `GET /interviews/:id/state`,
  `POST /interviews/:id/{profile,answers,resume}` and the SSE stream at
  `GET /interviews/:id/events`.
- **I11** provides the `kind='listing'` path on `POST /uploads`.
- **R01** serves the ready report at `GET /interviews/:id` (see Open blockers — the handler
  is unowned).
- **N01/N02** provide `GET /me/interviews`, `DELETE /interviews/:id`, `GET /admin/interviews`,
  `GET /admin/stats`.
- **V02/V05** provide the voice mint and webhook path the voice room binds to.

Set up the environment once foundations land:

```bash
docker compose up -d           # full stack incl. edge, or:
npm install                    # root — installs the frontend workspace
npm run -w frontend dev        # next dev, if running the SPA against a composed API
```

The frontend component ring runs from the repo root or the workspace:

```bash
npm run -w frontend test                          # all component specs (vitest)
npm run -w frontend test -- src/app/page.test.tsx # one file
npx playwright test                               # smokes against `docker compose up`
```

## Open blockers / decisions for the user

- **`GET /me/interviews` returns no score.** `backend/modules/interview/my-interviews.ts` ships
  `state/mode/occupation/endedReason/{created,started,ended}At` only, so W08's rows show state +
  date, not the "outcome and score" the frontend spec's screen 13 asks for. Adding
  `reports.payload.overall_score` to that projection is N01/interview-core work, not a frontend
  fix. **Owner: Fatih (admin ledger).** Blocks nothing; the row already links to the full report.

- **`GET /interviews/:id` exists but is thin — resolved for W07, still a gap for the spec.** R01
  shipped `backend/modules/interview/get.ts` returning `{ interviewId, state, report }`, not the
  spec's `{ interview, transcript, report? }` (backend spec line 107). W07 reads `transcript` +
  `endedReason` from room-state instead (ADR-W08) and needs nothing more. **Not a frontend fix** —
  if the documented shape matters to another consumer, it is R01/interview-core work.

- **A `kind='cv'` upload is never linked to the account.** W04 posts the PDF to `POST /uploads`
  and gets an `uploadId`, but nothing writes `users.cv_upload_id` or `profile.cv_text`:
  `uploads.ts` only creates the row, and `patchMyProfile`'s Zod cards strip an unknown
  `cvUploadId`, so `GET /me/profile` returns `cvUploadId: null` forever. This is **A06 step 5**,
  explicitly deferred in that task's Notes (it waited on I11, which is now `done`). Frontend
  cannot close it — the fix is one `prisma.user.update` in the backend. **Owner: Ahmet (auth
  ledger).** Blocks the CV reaching the interview prompt; blocks no frontend task.

- **`POST /interviews` returns only `{ interviewId, hrCount, techCount }`** (`setup.ts:85`),
  not the `occupation`/`occupationCluster`/`language` the setup screen's "detected summary,
  editable" step (§3.7, W05) needs. W05 renders the count split it does get and marks the
  occupation/language editor pending on an I03 response extension. Flag to the interview-core
  owner (Sezai) — it is an I03 response-shape gap, not a W05 defect.

## Task ledger (W01–W12)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo (the `frontend/` workspace). Dependency-sorted.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| W01 | UI build/seed checks: token lint, AA-contrast (incl. gradient stops), avatar/mascot set completeness + budgets + content-hash keys, gradient route-list, shadow-tier | | done | F01, F02 |
| W02 | App shell + React Query data layer + `useInterviewEvents` SSE hook + error-code→route map + locale switcher | | done | F01, A01 |
| W03 | Landing (screen 1) + `<Mascot>` primitive with per-pose preload | | done | W01, W02 |
| W04 | Onboarding host (screens 6–8): 3 cards, per-card PATCH, CV upload, skip/complete, server-derived resume | | done | W02, A06 |
| W05 | Setup (screen 9) + 390px mobile: listing textarea, chips, option cards, detected-summary edit, pre-questions/skip | | done | W02, I03, I04, I11 |
| W06 | Interview room text mode (screen 11) + widgets + 390px: two tiles, banner, avatar state machine, typed animation, guarded submit, handover, report-wait | | done | W02, I03, I06, I07 |
| W07 | Report + transcript (screen 12): report-wait (SSE + bounded poll) → render `ReportPayload` read-only | | done | W02, R01 |
| W08 | History (screen 13) as the signed-in `/`: list, Continue, confirm-then-Delete | | done | W02, N01 |
| W09 | Pre-join device check (screen 10, voice): camera off-by-default, mic level bar, continue-in-text | | done | W06, V02 |
| W10 | Voice room surface (screen 11-voice): live ASR transcript, mic level, self-camera, amplitude avatar driver | | done | W09, V02, V05 |
| W11 | Admin list + stats (screen 14): tables + Recharts bound to `/admin/stats` as-returned | | done | W02, N01, N02 |
| W12 | Admin console: the remaining five sections, real filters, and the `/admin/interviews/:id` drill-down | | done | W11, N03, N04, N05 |

## Critical path (the demo path)

W01/W02 (foundation) → **W03 → W04 → W05 → W06 → W07** is the demoable candidate spine
(land → onboard → set up → answer in text mode → **see the report**). **W07 closes the demo
path.** W08 (history) finishes "find it again". Off the spine: W03 needs W01+W02; the auth
family (screens 2–5) already shipped in the auth ledger. Voice (W09→W10) hangs off W06 and the
voice ledger; admin (W11 → W12) hangs off W02 and the admin ledger, off the candidate path — W12
waits on N03–N05 the way W11 waited on N01/N02.

## Cross-ledger dependencies (blocks this ledger)

**No frontend task may be merged until its cited cross-ledger tasks are green.** A partial
state (e.g. I03 done but I06 not) means the room can read state but cannot submit an answer.

| Ledger task | Provides | Needed by |
|---|---|---|
| F01 | `tokens.css` registry, `messages/{en,tr}.json` (`errors.*`), `@interviewly/types`, `AvatarState`/`MascotPose` unions | W01–W11 |
| F02 | `seed.ts` avatar/mascot objects, `personas.avatar_set` shape | W01, W06 |
| A01 | `GET /me`, session cookie, `api.ts`/`auth-redirect.ts`/`use-require-auth.ts`/`use-error-message.ts` (shipped in A03) | W02–W11 |
| A06 | `GET/PATCH /me/profile`, `POST /me/profile/complete`, `POST /uploads?kind=cv`, extended `GET /me` | W04 |
| I03 | `POST /interviews`, `GET /interviews/:id/state`, ownership + CSRF | W05, W06 |
| I04 | `POST /interviews/:id/profile` | W05 |
| I06 | `POST /interviews/:id/answers` (`{ questionId, transcript, inputMode }`) | W06 |
| I07 | SSE stream `GET /interviews/:id/events`, `POST /interviews/:id/resume` | W06 |
| I11 | `POST /uploads?kind=listing` | W05 |
| R01 | ready report served at `GET /interviews/:id` (handler unowned — see blockers) | W07 |
| N01 | `GET /me/interviews`, `DELETE /interviews/:id`, `GET /admin/interviews` | W08, W11 |
| N02 | `GET /admin/stats` (K11 fixed metrics, extended with `totalCostUsd` + `perModel[]`) | W11, W12 |
| N03 | security / budget / time events written to `audit_logs` (US-29) — the rows the audit trail and the drill-down timeline read | W12 |
| N04 | `GET /admin/interviews/:id` (drill-down) + the interview-list facets; `userEmail` and `budgetUsd` on the row | W12 |
| N05 | `GET /admin/{llm-calls,users,sessions,audit,queue}` and `totalCostUsd`/`perModel[]` on `/admin/stats` | W12 |
| V02 | voice session mint | W09, W10 |
| V05 | voice webhook / reconciliation path | W10 |

## Cross-ledger dependencies (this ledger blocks)

None. The frontend is the consuming edge — no other ledger waits on a `W` task.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- ~~**Admin per-call cost detail** (`/admin/interviews/:id`, US-26/29)~~ — **promoted and done as
  W12.** The endpoint landed (N03–N05) and the route exists.
- ~~**Rich admin filters**~~ — **done in W12**: cluster/state/user, provider/model/interview,
  role/search, session user + active-only, and audit action/actor/subject, all applied by the
  backend and all part of the query key.
- **Requeue a dead report job from the console.**
  `POST /admin/interviews/:id/report/requeue` is mounted (`backend/modules/admin/router.ts:37`)
  and nothing in the frontend calls it. The dead-letter list in `queue-panel.tsx` is where the
  button belongs. Needs a task — it would be the console's first write; every admin surface is
  read-only today.
- **Admin nav affordance** — W11 shipped `/admin` with no link to it from `components/chrome`; an
  admin types the URL. The nav is W02 surface and no task numbers the entry. Promote with the
  drill-down work, or sooner if a demo needs it clickable.
- **Adaptive candidate-analysis view** (`adaptive/PLAN.md:118`) — adaptive ledger, not this one.
- **Real illustrated avatar/mascot artwork** — the F02-seeded placeholders satisfy W01's
  completeness/budget checks; swapping bytes at content-addressed keys needs no task.
- **Download-PDF button** (US-24) — W07 reserves the slot only; the rendered PDF is worker/R02.
  Promote when R02 serves a `pdf_key` via the I12 signed-URL endpoint.
- **`interviews.language` occupation/language editor on setup** — blocked on the I03
  `POST /interviews` response gap (see Open blockers); promote when I03 returns the detected
  occupation/language.
