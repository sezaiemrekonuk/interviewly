# W04 — Onboarding host (screens 6–8): the three-step profile cards
REPO: (this repo) · Depends: W02, A06 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — a linear three-step wizard over a settled per-step API. The
merge-not-replace save and the first-run routing already exist (A06 / `auth-redirect.ts`); this is
composition, not new state-machine design.

## Goal
Owner's ask (frontend spec screens 6–8):

> "Onboarding — the destination the first-run redirect already points at. Three steps (screens
> 6–8): the profile basics, the CV upload, and the confirm/complete. Each step saves independently;
> the mascot is present; completing routes to setup."
> — frontend spec §Behaviour screens 6–8; PLAN_FRONTEND_LEDGER.md §3 phase 2

Build the onboarding route family (`/onboarding/[step]`) — the three cards A06's first-run redirect
already targets — over the A06 profile endpoints.

## Security boundaries
- **Auth-gated.** The route uses `useRequireAuth()` (A03); on `UNAUTHENTICATED` it redirects to
  sign-in preserving the return path. An unauthenticated user never sees a step.
- **A completed user does not re-onboard.** If `onboardingCompletedAt` is set (`GET /me/profile`),
  the host redirects to `/interviews/new` (setup) rather than re-showing step 1 — completion is
  idempotent (A06 `POST /me/profile/complete`).
- **CV upload is the backend's trust boundary, not the client's.** The client posts to `/uploads`
  and shows progress/validation errors from the response codes (`CV_*`); it does not itself vet the
  bytes beyond an accept filter.

## Non-negotiables
- **Merge-not-replace per step** (A06). Each step saves via `PATCH /me/profile` with
  `{ step, fields }`; a step never resends another step's fields. Draft edits persist so a back-nav
  re-hydrates from `['me','profile']`.
- **Step → pose** (ui): step 1 `point`, step 2 `think`, step 3 `cheer`. Use the W03 `<Mascot>`.
- **Onboarding is an entry surface** — gradient ground + `--shadow-soft`, pulled from W01's
  constants; hero at 56/40 from the closed type scale.
- **States (verbatim from the screen table):** loading = the step skeleton while `['me','profile']`
  resolves; error = the mapped `errors.<CODE>` inline (a failed save keeps the draft, does not
  advance); empty = a fresh profile shows blank fields, not a spinner.
- **Complete routes forward.** `POST /me/profile/complete` success → navigate to `/interviews/new`;
  on replay (already complete) the same navigation, no error surfaced.
- **Both locales** carry the `onboarding.*` copy (ADR-W05).

## Context (anchors)
- `frontend/src/app/(onboarding)/onboarding/[step]/page.tsx` — **create.** The step host: reads
  `step` from the route, guards auth + completion, renders the step card, wires prev/next, saves
  through `PATCH /me/profile`. Uses the entry layout (reuse `(auth)/layout.tsx`'s ground or a
  sibling `(onboarding)/layout.tsx` that imports the same ground module).
- `frontend/src/components/onboarding/step-basics.tsx` — **create.** Step 1 fields (profile basics
  per A06's step-1 Zod), `point` mascot.
- `frontend/src/components/onboarding/step-cv.tsx` — **create.** Step 2: `POST /uploads` (`kind=cv`)
  with progress + `CV_*` error mapping; `think` mascot; the upload id is stored on the profile via
  the step save.
- `frontend/src/components/onboarding/step-confirm.tsx` — **create.** Step 3: read-back summary +
  the `POST /me/profile/complete` CTA (`--primary`); `cheer` mascot.
- `frontend/src/lib/query.ts` (:W02) — reuse `['me','profile']`; add a `useProfile()` hook + a
  `PATCH /me/profile` mutation with no retry (W02 policy) that invalidates `['me','profile']`.
- `frontend/messages/{en,tr}.json` — **modify.** `onboarding.*` in both files.
- `frontend/src/app/(onboarding)/onboarding/[step]/page.test.tsx` — **create.** RTL over mocked
  fetch: each step saves only its own fields; a save failure keeps the draft + shows the mapped
  error; completing navigates to `/interviews/new`; a pre-completed profile redirects away from
  step 1.
- REFERENCE §backend-surface (A06 rows), `use-require-auth.ts`, `auth-redirect.ts` (:A03) — reuse.

  **The trap:** the step-1/2/3 saves must be independent `PATCH`es with `{ step }` set — a single
  "save everything on complete" call violates A06's merge-not-replace contract and loses a
  half-finished profile on a mid-flow drop. Save per step, complete only finalizes.

## Steps
- [x] **1. `useProfile()` + `PATCH /me/profile` mutation** in `query.ts` (no retry, invalidate
  `['me','profile']`).
- [x] **2. `(onboarding)` layout/host** — auth + completion guard, step routing, prev/next.
- [x] **3. `step-basics` / `step-cv` / `step-confirm`** with their poses; CV upload maps `CV_*`.
- [x] **4. `onboarding.*` copy** in both message files.
- [x] **5. `page.test.tsx`** — per-step isolated save, failure keeps draft, complete → setup,
  pre-completed redirects.
- [x] **6. Run the `## Verification` command.**

## Definition of done
- `/onboarding/1|2|3` render the three cards with the `point`/`think`/`cheer` mascots; each step
  saves only its own fields via `PATCH /me/profile { step, fields }`.
- A save failure surfaces the mapped `errors.<CODE>` inline and keeps the draft (no advance).
- `POST /me/profile/complete` routes to `/interviews/new`; an already-complete user is redirected
  off step 1; an unauthenticated user is redirected to sign-in.
- Copy resolves in EN and TR.

## Verification
```bash
npm run -w frontend test -- "src/app/(onboarding)"
```
Expected: the onboarding suite passes — per-step isolated saves, draft-preserving errors,
complete→setup navigation, and the completion/auth guards.

## Notes

A06 had already shipped a raw-`fetch` version of `/onboarding/[step]` (its Notes say so). This
task rewired it, it did not create it.

What exists now:
- `lib/query.ts`: `useProfile(enabled)`, `useSaveProfileCard()`, and the shared types
  `AccountProfile` / `EducationRow` / `ProfileResponse` / `ProfileCard`. **W05+ import these,
  do not redeclare a profile shape.** The mutation throws `ApiError(code)` and invalidates
  `queryKeys.meProfile()`; no retry (W02 policy).
- `lib/api.ts`: `apiPost` / `apiPatch` / `apiUpload` now share one `apiSend`. `apiUpload(kind,
  file)` posts multipart with no content-type header (the browser sets the boundary).
- `page.tsx`: `useRequireAuth` gates the query (`enabled`); server state is **never mirrored
  into local state** — `draft` holds only touched fields and the query's copy is the fallback
  (`draft.fullName ?? profile?.fullName ?? ''`), so there is no hydration effect and a
  post-save refetch cannot stamp on a live edit. `saveError` renders `errors.<CODE>` inline and
  blocks the advance; the component returns `null` while a redirect (completed / too-far
  deep-link) is in flight.

Deviations from the task text:
- No `components/onboarding/step-*.tsx` split. The three cards are three branches in one
  ~280-line file; splitting them means threading 8 draft fields through props for no reuse.
- Date of birth still not collected (A06 left it out; backend accepts and strips it).
- CV upload posts and reports fine, but **nothing links the upload to the account** — see
  STATE.md Open blockers (A06 step 5, owner Ahmet).

Verification (`npm run -w frontend test -- "src/app/(onboarding)"`): 4 passed. Root ring 240
passed, `npm run lint` / `typecheck` / `npm run -w frontend build` all clean.

**`npm run lint` is not the gate husky runs.** The pre-commit hook runs
`eslint --config frontend/eslint.config.mjs` on staged files, which carries React-Compiler
rules the root config does not (`react-hooks/set-state-in-effect` rejected the first
hydration-effect version). Run that config on changed frontend files before committing.

For W05: mock `useRouter` as one hoisted object (a fresh object per call loops
`useRequireAuth` forever), and wrap a `use(params)` page in
`await act(async () => { render(...) })` inside `<Suspense>`.
