# Frontend — State

Last updated: 2026-08-05
Last session ended: **W08 done — `/dashboard` lists, paginates and soft-deletes.**
`GET /me/interviews` carries **no score** (`my-interviews.ts` → id/state/mode/occupation/
endedReason/createdAt/startedAt/endedAt), so a row is **occupation + outcome + date**; the score
stays on the report — the task's "score summary" is an endpoint gap, logged in `## Open blockers`.
Outcome key = `endedReason ?? (state==='evaluating' ? 'evaluating' : 'inProgress')`. Delete is
**not** optimistic: `useDeleteInterview` invalidates the `['me','interviews']` prefix, the refetch
drops the row. `useInterviewList(enabled)` mirrors `useProfile(enabled)` — gated on
`useRequireAuth`. Ring: frontend 177, root 287.

Previous: **W07 done — the demo path is closed** (land → … → room → **report**).
`/interviews/:id` reads **two** endpoints (ADR-W08): `GET /interviews/:id` is thin
(`{interviewId,state,report}`), so `transcript` + `endedReason` come from room-state — `get.ts` was
not patched, it is another ledger's file. **`useInterviewEvents` now invalidates the
`['interview',id]` prefix**, not the state key, so one nudge covers both reads; the room is
unaffected and its `queryKey` param sketch was dropped. `ReportPayload` is **snake_case verbatim**
(`overall_score` int 0..5, `improvements` not "gaps") per `packages/ai/src/schemas.ts`. Poll
fallback = `useReport(id, poll)` 5 s, off at `<ReportWait onTimeout>`'s 60 s ceiling.
Ring: frontend 170, root 280.

Previous: **W06 done.** `/interviews/:id/room` renders text mode off `['interview',id,'state']`
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

**W09 (`<- W06, V02`)** is next — pre-join device check, screen 10 (sonnet-tier). W11 is also
eligible (`<- W02, N01, N02`, all `done`); § 4 order picks the lowest ID. W10 still waits on W09.

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

- **`GET /me/interviews` returns no score**, so W08's rows cannot show the "score summary" the
  frontend spec's screen 13 asks for. `my-interviews.ts` deliberately withholds cost/token figures
  (ADR-N02) but drops the score with them; the report's `overall_score` lives on `reports`, one
  join away. W08 ships occupation + outcome + date and links to the report for the number.
  **Owner: Fatih (admin ledger, N01).** Blocks no task — a display gap, not a broken screen.

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

## Task ledger (W01–W11)

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
| W08 | History / dashboard (screen 13): list, Continue, optimistic Delete | | done | W02, N01 |
| W09 | Pre-join device check (screen 10, voice): camera off-by-default, mic level bar, continue-in-text | | todo | W06, V02 |
| W10 | Voice room surface (screen 11-voice): live ASR transcript, mic level, self-camera, amplitude avatar driver | | todo | W09, V02, V05 |
| W11 | Admin list + stats (screen 14): tables + Recharts bound to `/admin/stats` as-returned | | todo | W02, N01, N02 |

## Critical path (the demo path)

W01/W02 (foundation) → **W03 → W04 → W05 → W06 → W07** is the demoable candidate spine
(land → onboard → set up → answer in text mode → **see the report**). **W07 closes the demo
path.** W08 (history) finishes "find it again". Off the spine: W03 needs W01+W02; the auth
family (screens 2–5) already shipped in the auth ledger. Voice (W09→W10) hangs off W06 and the
voice ledger; admin (W11) hangs off W02 and the admin ledger, off the candidate path.

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
| N02 | `GET /admin/stats` (K11 fixed metrics) | W11 |
| V02 | voice session mint | W09, W10 |
| V05 | voice webhook / reconciliation path | W10 |

## Cross-ledger dependencies (this ledger blocks)

None. The frontend is the consuming edge — no other ledger waits on a `W` task.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **Admin per-call cost detail** (`/admin/interviews/:id`, US-26/29) — its backend endpoint is
  unowned (admin ledger Backlog, `admin/STATE.md:113`). **Flag Fatih to number
  `GET /admin/interviews/:id` in the admin ledger**; once it is a numbered task, promote this to
  `W12` depending on it. Do not build the UI against a phantom route.
- **Rich admin filters** beyond cluster/state/user list columns — promote when a filter spec exists.
- **Adaptive candidate-analysis view** (`adaptive/PLAN.md:118`) — adaptive ledger, not this one.
- **Real illustrated avatar/mascot artwork** — the F02-seeded placeholders satisfy W01's
  completeness/budget checks; swapping bytes at content-addressed keys needs no task.
- **Download-PDF button** (US-24) — W07 reserves the slot only; the rendered PDF is worker/R02.
  Promote when R02 serves a `pdf_key` via the I12 signed-URL endpoint.
- **`interviews.language` occupation/language editor on setup** — blocked on the I03
  `POST /interviews` response gap (see Open blockers); promote when I03 returns the detected
  occupation/language.
