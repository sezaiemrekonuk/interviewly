# W08 — History / dashboard (screen 13): the interview list, empty state, and soft-delete
REPO: (this repo) · Depends: W02, N01 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — a cursor-paginated list with an empty state and a delete action over
a settled endpoint. No state machine, no trust boundary the client owns.

## Goal
Owner's ask (frontend spec screen 13):

> "The dashboard / history — the list of the user's past interviews with their outcome and score,
> paginated, each row linking to its report; a first-time user sees the empty state that points at
> setup; a row can be deleted."
> — frontend spec §Behaviour screen 13; PLAN_FRONTEND_LEDGER.md §3 phase 4

Build the dashboard route `/dashboard` over `GET /me/interviews` (N01) and `DELETE /interviews/:id`
(N01), each row linking to its `/interviews/:id` report (W07).

## Security boundaries
- **Auth-gated** via `useRequireAuth()`; unauthenticated → sign-in preserving the path.
- **The list is the user's own** — `GET /me/interviews` excludes deleted and scopes to the caller;
  the client shows exactly what the endpoint returns and never requests another user's list.
- **Delete is a soft delete** (`DELETE /interviews/:id` → `204`); the client removes the row and
  invalidates the list — it does not assume hard deletion or expose an undelete.

## Non-negotiables
- **Cursor pagination** — `GET /me/interviews` → `{ items, nextCursor }`; the list uses the
  `['me','interviews',{cursor}]` key (W02) and loads more via `nextCursor`. No offset paging.
- **Delete does not retry** (W02 mutation policy); on `204` it invalidates `['me','interviews']` and
  the row disappears on the refetch — no optimistic removal that could resurrect on error.
- **The dashboard is NOT an entry surface** — flat `--bg`, `--shadow-hairline`, no gradient. The
  empty state may show the `shrug` mascot (ui: `shrug` = empty/error) — the only mascot allowed on
  this screen, and only in the empty state.
- **States (verbatim):** loading = the list skeleton while the first page resolves; error =
  W02-routed / inline `errors.<CODE>`; **empty** = the first-time state (no interviews) with the
  `shrug` mascot and a `--primary` CTA to `/interviews/new`, not a bare "no results".
- **Each row** shows the outcome (`endedReason`) and score summary and links to `/interviews/:id`
  (W07). A still-`evaluating` row links to the report-wait beat, not a broken score.
- **Both locales** carry `dashboard.*`.

## Context (anchors)
- `frontend/src/app/dashboard/page.tsx` — **create.** The history host: `useInterviewList()` over
  `GET /me/interviews`; render rows (outcome + score + link), the load-more control, the empty
  state; guard auth; route errors.
- `frontend/src/components/dashboard/interview-row.tsx` — **create.** One row: outcome, score,
  a `Link` to `/interviews/:id`, and the delete affordance.
- `frontend/src/components/dashboard/empty-state.tsx` — **create.** The `shrug` mascot (W03
  `<Mascot>`) + the `--primary` CTA to `/interviews/new`.
- `frontend/src/lib/query.ts` (:W02) — add `useInterviewList()` on `['me','interviews',{cursor}]`
  (cursor pagination via `getNextPageParam`) and a `DELETE /interviews/:id` mutation (no retry,
  invalidates the list).
- `frontend/messages/{en,tr}.json` — **modify.** `dashboard.*` in both files.
- `frontend/src/app/dashboard/page.test.tsx` — **create.** RTL over mocked fetch: rows render from
  `items` and link to `/interviews/:id`; `nextCursor` drives a load-more; an empty `items` shows the
  `shrug` empty state with the setup CTA; a delete calls `DELETE /interviews/:id` and the row
  disappears after the list refetch.
- REFERENCE §backend-surface (`GET /me/interviews`, `DELETE /interviews/:id`), `use-require-auth.ts`
  — reuse.

  **The trap:** the empty state is a designed screen (mascot + setup CTA), not a "no results" line —
  a first-time user landing on a bare empty list is the spec's named failure. And do not
  optimistically drop the deleted row before the `204`; invalidate and let the refetch remove it.

## Steps
- [x] **1. `useInterviewList()` + `DELETE` mutation** in `query.ts` (cursor pages, no delete retry).
- [x] **2. `interview-row.tsx`** — outcome, score, report link, delete affordance.
- [x] **3. `empty-state.tsx`** — `shrug` mascot + `--primary` setup CTA.
- [x] **4. `dashboard/page.tsx`** — list + load-more + empty branch; flat `--bg`; guard auth.
- [x] **5. `dashboard.*` copy** in both files.
- [x] **6. `page.test.tsx`** — rows+links, load-more via cursor, empty state, delete→refetch.
- [x] **7. Run the `## Verification` command.**

## Definition of done
- `/dashboard` lists the user's interviews from `GET /me/interviews`, each row linking to its
  `/interviews/:id` report; `nextCursor` drives load-more (no offset paging).
- An empty list renders the designed `shrug` empty state with a `--primary` CTA to `/interviews/new`
  — not a bare "no results".
- Deleting a row calls `DELETE /interviews/:id` (no retry) and removes it via a list refetch on
  `204`; copy resolves EN + TR; no gradient, the only mascot is `shrug` in the empty state.

## Verification
```bash
npm run -w frontend test -- src/app/dashboard/page.test.tsx
```
Expected: the dashboard suite passes — rows link to reports, cursor load-more works, the empty state
shows the `shrug` mascot + setup CTA, and delete removes the row after the refetch.

## Notes

**Shipped.** `/dashboard` — 7 tests, `src/app/dashboard/page.test.tsx`. Ring: frontend 177, root 287.

**`GET /me/interviews` has no score.** `backend/modules/interview/my-interviews.ts` returns
`{id,state,mode,occupation,endedReason,createdAt,startedAt,endedAt}`. The step-2 "score" is not
available; a row is **occupation + outcome + started-date**, and the score is one click away on
the report. Logged in `STATE.md` → `## Open blockers` (owner Fatih, N01). `InterviewListItem` in
`query.ts` is that shape verbatim — do not re-add `overallScore`.

**Outcome copy.** `outcomeKey()` in `interview-row.tsx`: `endedReason ?? (state === 'evaluating'
? 'evaluating' : 'inProgress')`. `dashboard.outcome.*` carries all six `EndedReason` values plus
those two. A still-running or evaluating row links to `/interviews/:id` anyway — W07 renders the
wait beat at that URL, no branch here.

**Delete.** `apiDelete()` (new, `api.ts`) → `useDeleteInterview()`. Not retried (global
`mutations.retry:false`), **not optimistic**: `onSuccess` invalidates the `['me','interviews']`
prefix and the refetch removes the row. The infinite query is stored under
`queryKeys.meInterviews()` = `['me','interviews',{cursor:null}]`, which that prefix covers.

**`useInterviewList(enabled = true)`** — pass `!authLoading && user !== null`, same shape as
`useProfile(enabled)`. Without it the list fires before `/me` resolves and eats a 401.

**Styling.** `src/app/dashboard/dashboard.module.css`, shared by the page and both components.
Flat `--bg`, `--shadow-hairline`, no gradient. W01's `ui-checks/tokens.test.ts` rejects raw hex
and non-multiple-of-4 px — `#fff` and `padding: 8px 14px` both tripped it; use `var(--surface)`
and 4-multiples.

**For W09/W11:** `apiDelete` and the cursor-page pattern (`initialPageParam: null`,
`getNextPageParam: (p) => p.nextCursor`) are reusable as-is. `useFormatter().dateTime` is the
locale-safe date render — no `toLocaleDateString`.
