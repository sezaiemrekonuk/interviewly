---
task: W12
author: Sezai
sessions: [2026-08-11]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 1
tools: [ponytail, caveman]
---

## Session 1 — 2026-08-11

### What I asked for / what came back
- Asked for the five `Spec` sections plus the drill-down in one pass, against N03–N05's
  endpoints. Came back close to shippable: six hooks, six components, both routes. The two
  things it got structurally wrong were the ones with a cache in them (below).
- Asked it to keep the recharts brief DESIGN.md §5 specified at the time. Refused and wrote
  ADR-W09 instead — recharts writes inline `style` attributes and `style-src 'self' 'nonce-…'`
  drops them, so the charts would render empty in production and green in jsdom. The dependency
  is installed and has zero imports; it stays that way. DESIGN.md's W11 block was rewritten in
  the same session to say `Meter` and to stop calling the drill-down backlogged — it described
  a surface that no longer existed.

### Methodology trace
spec §7 (`:419-425`) + route map `:77` → `admin/page.test.tsx` 7 → 15 and a new
`interviews/[id]/page.test.tsx` at 7 → red → green. 22/22, ui-checks 92, i18n 3, tsc clean.
The load-bearing new case is "the platform total is the backend's and NOT the sum of the rows on
screen": stats and the visible rows are stubbed to disagree on purpose, so a regression to
client-side summing fails rather than merely looks different.

### Friction
- **next-intl cannot address a message key containing a dot.** Audit actions arrive dotted
  (`interview.soft_deleted`) and the obvious `t('audit.action.interview.soft_deleted')` resolves
  a nested path that does not exist. Stored with dots replaced by underscores, looked up through
  `t.has()` with the raw name as fallback. Caught by `src/i18n/messages.test.ts`, which walks
  keys by `split('.')` — a literal dot in a key makes that walk silently wrong, which is a better
  alarm than the screen printing a blank cell.
- **`react-hooks/refs` refuses a ref assigned during render.** The filter bar keeps a "latest
  props" ref so a 300 ms debounced text commit merges onto the newest `value` rather than the one
  captured at keystroke time (otherwise a select change between keystroke and commit is silently
  undone). Assigned during render it lints; moved into an effect. Same rule that bit W10 —
  root `npm run lint` is still not the gate, `frontend/eslint.config.mjs --max-warnings=0` is.
- The `AdminFilters<K>` index signature was needed before the third hook, not after: without it
  every call site casts to get a filter bag into both `queryKeys.*()` and `adminQuery()`, and a
  cast is exactly where the filter name and the query param stop agreeing.

### What I rejected and rewrote by hand
- **One shared filter bag across sections — rewritten to one per section.** It looks like less
  state. It carries `state=completed` from the interview list into the audit trail, where
  `state` means nothing, the backend ignores it or empties the result, and the operator reads an
  empty audit log as "nothing happened".
- **Filters kept out of the query key** in the first pass, with a manual `refetch()` on change.
  That is the previous filter's rows rendered for a frame after every change, on the one surface
  whose job is being right about money. Filters went into the key; `refetch()` went away.
- **Eight hooks enabled unconditionally.** Opening the console fired eight admin reads for one
  visible panel. Per-section `enabled`; overview/interviews/costs share two. Asserted in a test,
  because this is the kind of thing that silently comes back.
- **A shared `isPending` for the skeleton** — blanked the queue panel because the interview list
  it never asked for had not landed. The section's own query decides its skeleton.
- **The hardcoded `CEILING_MICRO = 500_000`.** Not a magic number to extract into config: it
  measured the deployment's current default budget, not the interview's, so every interview
  created before `BUDGET_USD_TEXT` last moved was flagged against a ceiling that was never its
  own. `/admin/interviews` projects `budgetUsd`; the row reads its own.
- **Five near-copies of `interview-table.module.css`,** one per new table. Renamed the original
  to `table.module.css` and pointed all five at it. Two tables that differ by accident teach an
  operator that the difference means something.
- Dropped the retired keys (`admin.spec.*`, `admin.scope`, `admin.interviews.noUserJoin`,
  `admin.filters.{mode,dateRange}`, `admin.costs.total`) rather than leaving them. Copy that
  describes a gap that has closed is a lie in two locales.
