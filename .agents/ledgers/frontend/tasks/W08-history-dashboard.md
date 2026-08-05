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
      Shipped as `useMyInterviews()` (`useInfiniteQuery`) + `useDeleteInterview()`; `apiDelete` added to `api.ts`.
- [x] **2. `interview-row.tsx`** — outcome, score, report link, delete affordance. → `components/home/interview-row.tsx`.
- [x] **3. `empty-state.tsx`** — `shrug` mascot + `--primary` setup CTA. Inlined in `authed-home.tsx`
      (no state, one branch, ~15 lines) rather than a third file.
- [x] **4. `dashboard/page.tsx`** — list + load-more + empty branch; guard auth. → the signed-in
      branch of `/` (`components/home/{home-switch,authed-home}.tsx`). Entry ground, not flat — see Notes.
- [x] **5. `dashboard.*` copy** in both files. → `home.*` (the namespace the surface is now called).
- [x] **6. `page.test.tsx`** — rows+links, load-more via cursor, empty state, delete→refetch.
      → `src/app/page.test.tsx`, 7 W08 cases beside the 7 landing cases.
- [x] **7. Run the `## Verification` command.** Run verbatim, exits 1 (no `/dashboard` route) — see Notes.

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

**Scope change, owner-directed: history is `/`, not `/dashboard`.** No `/dashboard` route exists
and none was created. `/` is now two screens — `components/home/home-switch.tsx` probes `GET /me`
with plain `apiGet` (the `chrome/header-nav.tsx` pattern) and `React.lazy(() => import('./authed-home'))`
swaps the marketing body for the history. Anonymous visitors never wait on the probe and never
pull React Query; `src/app/page.test.tsx` asserts both source-level facts (§8.1 budget).

Consequences of living on `/`:
- **Entry ground, not flat `--bg`.** `ENTRY_ROUTES` is a closed list (ui §4.2) and contains `/`.
  The task's "flat `--bg` + `--shadow-hairline`" was written for a standalone route; on `/` the
  closed list wins, so the panel is `--surface` + `--radius-panel` + `--shadow-soft`.
- **No `useRequireAuth()`.** `/` must render for anonymous visitors, so an unauthenticated `/me`
  is the marketing page, never a redirect to sign-in.
- STATE.md's row title says "optimistic Delete"; this file's Non-negotiables say the opposite and
  win — `useDeleteInterview` invalidates `['me','interviews',{cursor:null}]` and the row goes on
  the refetch. No retry (W02 policy).

Data layer (`lib/query.ts`): `useMyInterviews()` is one `useInfiniteQuery` on
`queryKeys.meInterviews()` — one key for all pages, so the delete invalidation does not have to
chase every cursor it ever fetched. `getNextPageParam` reads `nextCursor`; no offset paging.
`apiDelete` added to `lib/api.ts` (`apiSend` already tolerates a bodyless 204).

Row behaviour (N01 returns no score — `my-interviews.ts` ships `state/mode/occupation/endedReason/
timestamps` only, so the "score summary" the Goal asks for has no source):
- `created|profiling|hr_round|tech_round|paused` → **Continue** → `/interviews/:id/room`.
- `evaluating|completed` → **View report** → `/interviews/:id` (W07 shows the wait beat for `evaluating`).
- `failed|abandoned` → no action. `/interviews/:id` would poll a report that never lands.
- State chip: `--surface-sunken` bed, human label from `home.state.*`, family in an 8px
  `aria-hidden` dot (`--success` / `--accent` / `--text-muted`). `--success`/`--accent` are below
  the AA floor **as text** (3.8:1 on `--surface`), which is why they tint the dot and not the words.
  No `--live` (room-only), no `--danger` on a soft-deleted row.
- Relative date via next-intl `useFormatter().relativeTime` — no date library.

**Verification (as written) fails by design:** `npm run -w frontend test -- src/app/dashboard/page.test.tsx`
→ `No test files found, exiting with code 1`. The equivalent for where the screen actually lives is
`npm run -w frontend test -- src/app/page.test.tsx` → **14 passed**. Command left unedited on purpose
(EXECUTE §6.5 forbids rewriting it); the next session should treat the `/` command as the real one.

**For W09/W11:** `useMyInterviews`/`useDeleteInterview` are in `lib/query.ts` — reuse, do not re-add.
