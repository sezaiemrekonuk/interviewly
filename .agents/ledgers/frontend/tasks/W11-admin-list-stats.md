# W11 — Admin list + stats (screen 14): the interview table and the aggregate charts
REPO: (this repo) · Depends: W02, N01, N02 · Status: done
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
- [x] **1. Add `recharts`** to `frontend/package.json`; `npm install` at root.
- [x] **2. `useAdminInterviews()` + `useAdminStats()`** in `query.ts`.
- [x] **3. `interview-table.tsx`** — outcome/cost/tokens/`deleted` flag, cursor load-more, rows not
  linked.
- [x] **4. `stats-panel.tsx`** — the `recharts` split + per-occupation + weakest-questions + the
  duration/token figures.
- [x] **5. `admin/page.tsx`** — `FORBIDDEN` guard, compose table + stats; flat `--bg`, no mascot.
- [x] **6. `admin.*` copy** in both files.
- [x] **7. `page.test.tsx`** — non-admin not-authorized, admin rows+charts, cursor load-more, empty
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

**Shipped.** `/admin` = `StatsPanel` + `InterviewTable` under one `useRequireAuth` gate.

- `query.ts`: `useAdminInterviews(enabled)` (infinite, `?cursor=`) + `useAdminStats(enabled)`.
  `enabled` is `role === 'admin'` — a non-admin fires **no** `/admin/*` request at all (asserted).
  Types match `admin/REFERENCE.md` §item-shape / §stats-shape verbatim.
- Backend stays the gate: `FORBIDDEN` from either read renders the same not-authorized card, no
  redirect (`error-routing.ts` `not-authorized`, `/admin` branch).
- `costUsd` printed as the six-decimal string it arrives as. `totalTokens`/counts/scores go through
  `useFormatter().number` (grouping only). No metric is derived client-side.
- **Recharts colour is CSS, not props.** Recharts writes `fill` as a *presentation attribute*, which
  any stylesheet rule outranks — so `.seriesAccent/.seriesWarning/.seriesMuted` in
  `stats-panel.module.css` own the hues. Keeps `--primary` out and hex literals out of `.tsx`.
  Charts are `aria-hidden`; the readable copy is the legend list beside each one.
- Zeroed platform: the split ring gets `value: 1` per slice so the shape still draws while the
  legend prints the real `0`s. Bar chart + weakest list fall back to the `stats.empty` line.
- `src/test/setup.ts` gained a **no-op `ResizeObserver`** — jsdom has none and recharts'
  `ResponsiveContainer` constructs one on mount. Global on purpose: any later chart needs it.
- CSS uses `border-block-end/start` (not `border-bottom/top`) — `ui-checks/tokens.test.ts`'s
  spacing regex matches the substring `bottom: 1px` and flags the shorthand. Codebase-wide habit
  already; follow it.
- `admin.state.*` maps all 9 `InterviewState` values, `t.has` fallback to the raw string.

**Gaps, deliberate:** no admin link anywhere in `components/chrome` — an admin reaches `/admin`
by URL. Backlogged, not built: the nav is F01/W02 surface and no task numbers it.

**For the next session:** rows carry `id`/`userId` already, so the drill-down only needs the
`<tr>` wrapped in a `Link` once `GET /admin/interviews/:id` is numbered (flag Fatih).

## Design

Read `frontend/DESIGN.md` before writing CSS — §3 (composition patterns), §5 W11 brief, §6 (quality floor).
Non-negotiables for this surface: **admin compact density** — flat `--bg`, `--shadow-hairline`, no
gradient, no mascot, no `--live`. 13px/600 `--text-muted` header row, 14px data rows, 12/16px cell
padding, hairline rules (no zebra), numeric columns right-aligned with `tabular-nums`; the table
lives in an inner `overflow-x: auto` wrapper so the page never scrolls sideways at 390px. `deleted`
is a `--surface-sunken` pill, not `--danger`. Recharts series come from `--accent` / `--warning` /
`--text-muted` only — **never `--primary`** — read as token vars, not hex literals (the lint scans
`.tsx`); `isAnimationActive={false}`, custom token-styled tooltip, every series text-labelled.
Empty platform = zeroed charts + a designed empty line in the table card, never a spinner.
