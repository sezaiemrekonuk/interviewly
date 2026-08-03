# W11 — Admin list + stats (screen 14): the interview table and the aggregate charts
REPO: (this repo) · Depends: W02, N01, N02 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — an admin-gated table plus a charts panel over two settled read
endpoints. No state machine; the trust boundary (admin-only) is the backend's, reflected by the
client. Per-call drill-down UI is backlogged (needs `GET /admin/interviews/:id` numbered — flag
Fatih), so this task is list + stats only.

## Goal
Owner's ask (frontend spec screen 14):

> "The admin panel — the list of all interviews (including deleted, with cost and token totals) and
> the aggregate stats: average duration, the completed/cut-short/unfinished split, total tokens, the
> per-occupation breakdown, and the weakest questions."
> — frontend spec §Behaviour screen 14; PLAN_FRONTEND_LEDGER.md §3 phase 6

Build the admin route `/admin` — the interview list (`GET /admin/interviews`, N01) and the stats
charts (`GET /admin/stats`, N02). The per-call detail view is **out of scope** (backlogged; see
STATE — it needs `GET /admin/interviews/:id` numbered by the admin owner first).

## Security boundaries
- **Admin-only, enforced by the backend.** A non-admin hitting `/admin/*` gets `FORBIDDEN`, routed
  by W02's table to a not-authorized render (REFERENCE error table). The client does not itself
  decide admin-ness beyond reflecting `role` for the nav affordance; the endpoints are the gate.
- **The admin list includes deleted interviews** (`deleted` flag, N01) — the client shows the flag;
  it does not offer an undelete or expose PII beyond what the endpoint returns.
- **Cost/token totals are the backend's numbers** — rendered as returned, never recomputed client-side.

## Non-negotiables
- **Two reads, two keys:** `GET /admin/interviews` → `{ items, nextCursor }` on
  `['admin','interviews',filters]`; `GET /admin/stats` → the aggregate shape on
  `['admin','stats',filters]` (W02 factory). Cursor pagination for the list; no offset paging.
- **Stats shape is fixed (N02):** `{ averageDurationMs, completed, cutShort, unfinished,
  totalTokens, perOccupation[], weakestQuestions[] }`. The charts render these fields by name — do
  not invent a metric the endpoint does not return.
- **Charts use `recharts`** (ADR — a small charting dep; W11 adds it): the completed/cut-short/
  unfinished split, the per-occupation breakdown, and the weakest-questions list. Keep it out of the
  other routes' bundles (admin-only import).
- **The admin panel is NOT an entry surface** — flat `--bg`, `--shadow-hairline`, no gradient, no
  mascot. `--accent` may key chart series/headers; it is never a CTA; `--live` never appears here.
- **States (verbatim):** loading = the table + charts skeleton; error = `FORBIDDEN` → not-authorized,
  otherwise inline `errors.<CODE>`; empty = "no interviews yet" for the list and zeroed charts for
  stats (not a spinner) when the platform has no data.
- **Rich filters are out of scope** (backlog) — ship the list + the cursor pager + the stats charts;
  do not build the filter UI beyond what N01/N02 already accept as query params (if any).
- **Both locales** carry `admin.*`.

## Context (anchors)
- `frontend/package.json` — **modify.** Add `recharts` (dependency). `npm install` at root.
- `frontend/src/app/admin/page.tsx` — **create.** Admin host: guard `role`/route `FORBIDDEN`; render
  the list + the stats panel; `useAdminInterviews()` + `useAdminStats()`.
- `frontend/src/components/admin/interview-table.tsx` — **create.** The list: outcome, cost, tokens,
  the `deleted` flag, cursor load-more. Rows are **not** links yet (drill-down backlogged).
- `frontend/src/components/admin/stats-panel.tsx` — **create.** The `recharts` charts: the
  completed/cut-short/unfinished split, `perOccupation`, `weakestQuestions`, plus `averageDurationMs`
  and `totalTokens` as figures.
- `frontend/src/lib/query.ts` (:W02) — add `useAdminInterviews()` on `['admin','interviews',filters]`
  (cursor) and `useAdminStats()` on `['admin','stats',filters]`.
- `frontend/messages/{en,tr}.json` — **modify.** `admin.*` in both files.
- `frontend/src/app/admin/page.test.tsx` — **create.** RTL over mocked fetch: a non-admin
  (`FORBIDDEN`) sees the not-authorized render and no table; an admin sees rows from `items` + the
  charts from the stats shape; `nextCursor` drives load-more; an empty platform shows the empty
  list + zeroed charts.
- REFERENCE §backend-surface (`GET /admin/interviews`, `GET /admin/stats`), §error table — the
  authorities.

  **The trap:** do not make the rows link to a per-call detail page — `GET /admin/interviews/:id` is
  not owned yet (backlogged, flag Fatih). Linking to a route that renders nothing is a dead end; ship
  the list read-only until the drill-down endpoint is numbered.

## Steps
- [ ] **1. Add `recharts`** to `frontend/package.json`; `npm install` at root.
- [ ] **2. `useAdminInterviews()` + `useAdminStats()`** in `query.ts`.
- [ ] **3. `interview-table.tsx`** — outcome/cost/tokens/`deleted` flag, cursor load-more, rows not
  linked.
- [ ] **4. `stats-panel.tsx`** — the `recharts` split + per-occupation + weakest-questions + the
  duration/token figures.
- [ ] **5. `admin/page.tsx`** — `FORBIDDEN` guard, compose table + stats; flat `--bg`, no mascot.
- [ ] **6. `admin.*` copy** in both files.
- [ ] **7. `page.test.tsx`** — non-admin not-authorized, admin rows+charts, cursor load-more, empty
  platform. Run the `## Verification` command.

## Definition of done
- `/admin` renders the interview list from `GET /admin/interviews` (with the `deleted` flag, cost and
  tokens, cursor load-more) and the stats charts from `GET /admin/stats` (the fixed N02 shape).
- A non-admin (`FORBIDDEN`) sees a not-authorized render and no data; rows are not linked to a
  drill-down (backlogged); no fabricated metric appears.
- Charts use `recharts`, kept out of the non-admin bundles; flat `--bg`, no mascot; an empty platform
  shows the empty list + zeroed charts; copy resolves EN + TR.

## Verification
```bash
npm run -w frontend test -- src/app/admin/page.test.tsx
```
Expected: the admin suite passes — non-admin not-authorized, admin list + `recharts` stats from the
fixed shape, cursor load-more, and the empty-platform state.

## Notes

(Empty until the task is done.)
