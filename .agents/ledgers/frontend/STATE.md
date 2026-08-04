# Frontend — State

Last updated: 2026-08-04
Last session ended: **W04 done.** `/onboarding/[step]` now runs on React Query: `useProfile()`
+ `useSaveProfileCard()` in `lib/query.ts` (types `AccountProfile`/`ProfileResponse`/`ProfileCard`
live there too — W05+ reuse them, do not redeclare). A refused card PATCH sets `saveError`,
shows `errors.<CODE>` and does **not** advance; a completed account or a too-far deep-link
renders `null` while the redirect runs (no card flash). `api.ts` gained `apiPatch` + `apiUpload`
(multipart, no content-type). Poses point/think/cheer via W03's `<Mascot>`. **Test trap:**
`useRouter` must be mocked as ONE hoisted object — a fresh `{...}` per call re-runs
`useRequireAuth`'s effect forever and hangs `act`; `use(params)` needs
`await act(async () => { render(...) })`. Ring: frontend 129, root 240. New blocker below:
`kind='cv'` uploads are never linked to the user (A06 step 5 was deferred).

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

**W05 (`<- W02, I03, I04, I11`)** is next — setup, screen 9. W07/W08/W11 are also eligible
(deps `done`); § 4 order picks the lowest ID.

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

- **The edge cannot serve bucket objects, so every avatar/mascot `<img>` 404s in the composed
  stack** (found in W03). Two gaps, both infra, neither in a frontend task's scope: (1)
  `Caddyfile` uses `handle /assets/*` → `bucket:9000`, so MinIO receives `/assets/mascot/…` and
  reads `assets` as the bucket name — it needs the `interviewly` bucket segment (`handle_path` +
  rewrite, or a bucket named `assets`); (2) `seed.ts` PUTs the objects with a public-read cache
  header but never sets an anonymous-read bucket policy. Frontend resolves the key correctly
  (`mascotUrl`), so this is one Caddy route + one policy call away. **Chase in foundations
  (F03/F02, Sezai) as its own task — do not patch the Caddyfile from a `W` task.** Blocks
  nothing at test time; blocks the demo looking right.

- **`GET /interviews/:id` (report+transcript read) is owned by no task.** The backend spec
  defines it (line 107, `{ interview, transcript, report? }`) and report **R01**'s DoD assumes
  it (`report/tasks/R01-...md:127`), but no task adds the handler — the interview router has no
  `GET /:id` route. **W07 depends on R01** and is buildable against the documented shape (mocked
  API), but before anyone claims the demo path closed, confirm the handler exists in the running
  stack. Chase it in the report or interview-core ledger; do not add it from this ledger.
  (ADR-W07)
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
| W05 | Setup (screen 9) + 390px mobile: listing textarea, chips, option cards, detected-summary edit, pre-questions/skip | | todo | W02, I03, I04, I11 |
| W06 | Interview room text mode (screen 11) + widgets + 390px: two tiles, banner, avatar state machine, typed animation, guarded submit, handover, report-wait | | todo | W02, I03, I06, I07 |
| W07 | Report + transcript (screen 12): report-wait (SSE + bounded poll) → render `ReportPayload` read-only | | todo | W02, R01 |
| W08 | History / dashboard (screen 13): list, Continue, optimistic Delete | | todo | W02, N01 |
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
