# W12 — The admin console's remaining sections, filters and drill-down
REPO: (this repo) · Depends: W11, N03, N04, N05 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — a data-layer task, not a screen. Six new hooks, a filter-state
machine keyed per section, and a cache-key contract where getting the key wrong shows the
previous filter's rows for a frame. MODELS.md's own rule of thumb ("the data layer / a client
state machine = the expensive tier") puts this above W11's sonnet row.

## Goal
Owner's ask (frontend spec §7, US-26/27/28/29):

> "Tables and filters over `GET /admin/interviews` (occupation cluster / state / user; deleted
> rows shown with a `deleted` badge and cost intact), a per-interview drill-down over
> `GET /admin/interviews/:id` (per-call `llm_calls` rows: provider, model, `prompt_uuid`+version,
> units, unit_kind, cost, latency; plus security / budget / time events for US-29)…"
> — `.agents/specs/2026-07-29-frontend.md:419-425`; route map `:77`

W11 shipped `/admin` with eight nav sections and endpoints for three (`overview`, `interviews`,
`costs`). The other five — `modelCalls`, `sessions`, `users`, `queue`, `audit` — rendered a
hatched `Spec` placeholder carrying one honest sentence about the missing read, as did two
inline gaps (the fake filter chips, the "spend by model" card). The spec's
`/admin/interviews/:id` route did not exist at all. N03–N05 landed the endpoints. This task
consumes them: build the five sections, make the filters real, and build the drill-down.

## Security boundaries
- **Admin-only, enforced by the backend.** Six new reads sit behind the same `requireAdmin`
  gate. A `FORBIDDEN` from *any* of them renders the same in-place not-authorized card — never
  a redirect, on the console or the drill-down (bouncing a non-admin off `/admin/interviews/:id`
  confirms the interview exists).
- **Every hook is `enabled`-gated on `role === 'admin'`.** A non-admin fires no `/admin/*`
  request at all, on either route.
- **The drill-down leaks nothing the endpoint did not send.** `metadata` is an unknown JSON
  blob: only its scalar entries are printed, never a nested object stringified into a cell.
- **`INTERVIEW_NOT_FOUND` is its own state**, not an empty summary — existence is not leaked by
  the difference between "no rows" and "not yours".

## Non-negotiables
- **Filters are IN the query key.** A narrowed list is a different resource. One cache entry for
  both shows the previous filter's rows for a frame after every change, on a surface whose whole
  job is being correct about money.
- **One filter bag per section.** Shared state carries `state=completed` from the interview list
  into the audit trail, where it means nothing and silently empties the table.
- **Per-section `enabled`.** Opening the console is two requests (interviews + stats), not eight.
  Eight endpoints on every load would make `/admin` the most expensive request in the system,
  seven-eighths of it for a panel nobody opened.
- **The URL builder is written once** (`adminQuery`). Six hand-built query strings is how one of
  them ends up sending `state=undefined`.
- **Figures are the backend's.** `totalCostUsd` and `perModel[]` come from `/admin/stats`,
  aggregated in Postgres — never a sum of the rows the table happened to page in (K11). The
  per-cluster breakdown stays client-side and stays labelled loaded-rows-only: `perOccupation[]`
  counts interviews, not dollars, so cluster spend has no server-side source.
- **No `Spec` marker left standing for a missing endpoint.** `SpecPanel`, `admin.spec.*` and
  `admin.scope` go; a marker may only remain where the *data* is still absent, not the read.
- **No inline `style`, no new dependency, px only** (`frontend/AGENTS.md` §1–3). Bars are
  `components/shell/meter.tsx` — native `<progress>`, because `style-src 'self' 'nonce-…'`
  silently drops a style attribute in production and passes every jsdom test (ADR-W09).
- **Navigate through `src/i18n/navigation.ts`** — the locale is a path segment (AGENTS.md §5).
- **Both locales, same commit** (ADR-W05, AGENTS.md §4). Retired keys are deleted, not left.
- **Admin density holds** (DESIGN.md §5): flat `--bg`, `--shadow-hairline`, no gradient, no
  mascot, no `--live` outside a running interview's state pill; one table vocabulary, not six.

## Context (anchors)
- `frontend/src/lib/query.ts` (:W02, :W11) — **modify.** Six query keys (`adminInterview`,
  `adminLlmCalls`, `adminUsers`, `adminSessions`, `adminAudit`, `adminQueue`), the shared
  `adminQuery(path, filters, cursor)` builder, `AdminFilters<K>` with an index signature so one
  filter bag flows into both the key and the builder without a cast, and the six hooks.
  `useAdminInterviews` gains a `filters` argument. `useAdminQueue` polls on 30 s.
- `frontend/src/components/admin/table.module.css` — **rename** from `interview-table.module.css`;
  it is now the shared table vocabulary for all five tables. Gains `.srOnly`, `.open`,
  `button.pill`.
- `frontend/src/components/admin/{filter-bar,call-table,user-table,session-table,queue-panel,audit-table}.tsx`
  — **create.** `filter-bar` and `queue-panel` carry their own `.module.css`.
- `frontend/src/components/admin/interview-table.tsx` — **modify.** The account column (the row
  carried a bare cuid; `/admin/interviews` now projects `userEmail`) and an `Open` link per row.
- `frontend/src/components/admin/cost-panel.tsx` — **modify.** Platform total and per-model
  breakdown from `/admin/stats`.
- `frontend/src/app/[locale]/admin/page.tsx` — **modify.** All eight sections, `SpecPanel` gone,
  one filter bag per section, per-section `enabled`.
- `frontend/src/app/[locale]/admin/interviews/[id]/{page.tsx,detail.module.css,page.test.tsx}` —
  **create.** Summary, the report's prompt uuid + version (US-28's rollback handle), the per-call
  table, the US-29 event timeline.
- `frontend/messages/{en,tr}.json` — **modify.** Full parity; delete `admin.spec.*`,
  `admin.scope`, `admin.interviews.noUserJoin`, `admin.filters.{mode,dateRange}`,
  `admin.costs.total`.
- REFERENCE §backend-surface, §error table — the authorities. `backend/modules/admin/router.ts`
  is what actually mounts the six reads.

  **The trap:** the budget-ceiling flag was `CEILING_MICRO = 500_000` compared against every row.
  That constant measures the *deployment's current default*, not the interview's ceiling — an
  interview created before `BUDGET_USD_TEXT` moved is flagged at a number that was never its
  budget. `/admin/interviews` now projects `budgetUsd` per row; read that. The same trap in
  reverse is the cost panel: summing the loaded rows and calling it the platform total was
  honest only while no endpoint knew better, and `/admin/stats` now does.

## Steps
- [x] **1. `query.ts`** — six keys, `adminQuery`, `AdminFilters<K>`, six hooks; `filters` on
  `useAdminInterviews`; 30 s `refetchInterval` on `useAdminQueue`.
- [x] **2. Rename `interview-table.module.css` → `table.module.css`**; add `.srOnly`, `.open`,
  `button.pill`. All five tables read it.
- [x] **3. `filter-bar.tsx`** — select / text / toggle controls, fully controlled, debounced text.
- [x] **4. `call-table.tsx`, `user-table.tsx`, `session-table.tsx`, `queue-panel.tsx`,
  `audit-table.tsx`.**
- [x] **5. `interview-table.tsx`** — account column, per-row `Open` link, `atCeiling(row)` off
  `row.budgetUsd`.
- [x] **6. `cost-panel.tsx`** — `totalCostUsd` + `perModel[]` from the endpoint; cluster rows stay
  client-side and stay labelled.
- [x] **7. `admin/page.tsx`** — eight sections, `SpecPanel` gone, per-section filter bag and
  `enabled`.
- [x] **8. `admin/interviews/[id]/`** — summary, prompt uuid + version, per-call table,
  event timeline, in-place refusal, `INTERVIEW_NOT_FOUND` state.
- [x] **9. EN/TR copy** for every new surface; retired keys deleted.
- [x] **10. Tests** — `admin/page.test.tsx` 7 → 15; the drill-down's own 7. Run the
  `## Verification` commands.

## Definition of done
- All eight console sections render real data; no `Spec` marker stands for a missing endpoint,
  and `SpecPanel` / `admin.spec.*` / `admin.scope` are gone.
- Filters narrow through the backend, are part of the query key, and do not leak between
  sections; opening the console issues two requests, not eight.
- The costs section prints the backend's platform total and per-model breakdown; the cluster
  breakdown says out loud that it is the loaded rows.
- `/admin/interviews/:id` renders the summary, the report's prompt uuid + version, the per-call
  rows (a `unitKind: 'second'` voice call keeps its own row) and the US-29 event timeline; the
  interview table, the dead-letter list and the audit trail all link into it.
- A non-admin, and a `FORBIDDEN` answer to a client-side admin, get the in-place not-authorized
  card on both routes and issue no `/admin/*` request; copy resolves EN + TR at parity.

## Verification
```bash
npm test -- --run "frontend/src/app/[locale]/admin"
npm test -- --run frontend/src/ui-checks
npm test -- --run frontend/src/i18n
cd frontend && npx tsc --noEmit -p tsconfig.json
```
Expected: 22 admin cases green (15 console + 7 drill-down), the token/contrast ring green, EN/TR
parity green, typecheck clean.

## Notes

**Shipped.** Eight sections, all answered by an endpoint; `/admin/interviews/:id` exists.

- `query.ts`: six keys + `adminQuery(path, filters, cursor)` + `AdminFilters<K>`. The index
  signature is the point — without it every call site casts, and a cast is where a filter name
  and a query param stop agreeing. `useAdminStats` still takes **no** filters (`adminStats()`);
  it is a platform aggregate and narrowing it was never asked for.
- **Filters are in the key.** `queryKeys.adminInterviews(filters)` etc. `useAdminQueue` is the
  one polling read (30 s).
- Per-section `enabled`: `overview`/`interviews`/`costs` share the interview list + stats, so
  the console opens on **two** requests. Asserted.
- `atCeiling(row)` reads `row.budgetUsd`; `microUsd()`/`isUnpriced()` unchanged and now imported
  by `cost-panel.tsx` rather than duplicated.
- `table.module.css` is the one table vocabulary — `interview-table`, `call-table`, `user-table`,
  `session-table`, `audit-table` and the queue's dead letter all read it.
- Audit action labels: the wire value is dotted (`interview.soft_deleted`) and next-intl cannot
  address a key containing a dot, so the tree stores `interview_soft_deleted` and lookup is
  `t.has(...replaceAll('.', '_'))` with the raw name as fallback. Same `t.has` fallback pattern
  as W11's `admin.state.*`.
- `Meter`, not a chart library, for every bar — ADR-W09. Recharts stays installed and unimported.
- Sections stay client state; the drill-down is a real route — ADR-W10.

**What was verified, and what was not.** The four `## Verification` commands ran green: 22 admin
cases (15 + 7), 92 ui-checks, 3 i18n, `tsc --noEmit` clean. **A production `next build` was NOT
run in this session**, so the bundle budget and the real CSP were not exercised — which matters
more than usual here, since ADR-W09 is a decision *about* the production CSP that no test in the
ring can observe. **No Playwright smoke was added for `/admin/interviews/:id`**; the drill-down's
only coverage is jsdom over a mocked fetch.

**Two things deliberately still marked:**
- `stats-panel.tsx` keeps one `<Spec />`, on the `cutShort` note. It is not a missing endpoint:
  no backend path ever writes `ended_reason = 'cut_short'`, so the number is structurally 0. The
  marker is correct there and only there.
- `costs.totalNote` still says "the {count} interviews loaded here" for the **cluster** rows.
  `perOccupation[]` counts interviews, not dollars.

**Stale docs found, not patched here:** `frontend/DESIGN.md` §5's W11 brief still says "Rows are
**not** links (drill-down backlogged)" and specifies recharts chart chrome. Both are now wrong —
rows link, and ADR-W09 rejected recharts. DESIGN.md is canonical and owned by the design pass;
flag it rather than editing it from a task file.

**For the next session:** `POST /admin/interviews/:id/report/requeue` is mounted
(`backend/modules/admin/router.ts:37`) and nothing in the frontend calls it. The dead-letter list
is where the button belongs — a lost report job has no other way back. Needs a task; it is the
console's first write, and every surface here is read-only today.

## Design

Read `frontend/DESIGN.md` before writing CSS — §3 (composition patterns), §5 (the admin brief),
§6 (quality floor). Admin compact density carries over unchanged: flat `--bg`,
`--shadow-hairline`, 13px/600 `--text-muted` header rows, 14px data rows, hairline rules (no
zebra), numeric columns right-aligned with `tabular-nums`, every table inside its own
`overflow-x: auto` wrapper so the page never scrolls sideways at 390px. The filter bar sits
**above** the data, not in the header strip: three selects and a search box need the work
column's width, and a filter that wraps into the title row reads as chrome. It is `<search>`,
not `<form>` — every control applies on change, and a form would answer Enter with a navigation.
`.open` is a text link per row, not a clickable row: a row carries selectable ids an operator
copies, and a click target fights that. Bars are `Meter` (`decorative`) with the number stated
as text beside them. One `--primary` per surface; "Load more" stays secondary.
