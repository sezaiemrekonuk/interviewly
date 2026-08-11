# W13 — A filter builder and a sort on every console table
REPO: (this repo) · Depends: W12, N06 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — the same rule of thumb MODELS.md already states, applied twice
over: per-section query state that has to survive a section switch, a cache-key contract where
the sort and the query live in the key beside the filters, and one query string that two
controls read and write without being allowed to disagree. Screen composition would be the
sonnet tier; this is neither screen nor composition.

## Goal
Owner's ask:

> "Five tables with a dropdown each. I cannot find one interview by the account that ran it, I
> cannot ask which calls cost more than ten cents, and I cannot sort by anything. And I am not
> learning a query syntax to look at my own data — give me something I click: the field, the
> condition, the value. Every field, not the three somebody picked, and the same control on
> every table. Then let me click a column header."
> — owner, 2026-08-11, walking the console W12 shipped, then rejecting the search box that
> answered it first

N06 landed the grammar, the whitelist, the field descriptors and the order-carrying cursor.
This task is the operator's half, and it is **point-and-click, not syntax**: one search box for
words, one `Add filter` row of three dropdowns (field → condition → value) producing removable
chips, and one sortable header — on all five endpoint-backed tables and on the three whose rows
arrive whole inside a bigger payload. The chips and the words compose the same query string
underneath, so the request, the wire format and a shared link are exactly what the typed version
sent; what goes away is having to learn it.

## Non-negotiables
- **One query string is the single source of truth.** The chips and the search box are two views
  of it, not two pieces of state that can disagree — `parseQuery`/`serialiseQuery` are exact
  inverses and the tests pin the round trip. Two states would mean a chip removed and a word
  deleted racing each other, and it would mean a query arriving from a link having nowhere to go.
- **The query and the sort are IN the query key.** Same rule as the filters (W12): a filtered or
  re-sorted list is a different resource, and one cache entry for both shows the previous
  query's rows for a frame — on the surface whose job is being right about money.
- **The controls are built from the response's `query.fields`**, never from a copy of the
  whitelist. That is what makes the field list complete without hand-maintenance, and what makes
  an enum's dropdown offer the server's exact values — a control that can propose an option the
  server refuses is a control that produces an `ignored` term for a click.
- **Every field the table declares gets a control.** W12's hand-written facet bar covered three
  facets out of fifteen and had to be extended by hand for each new one; a filter that covers
  some of the columns teaches the operator to distrust the ones it does not.
- **An ignored term is shown.** `query.ignored` is rendered as a warning on the endpoint tables.
  A term that vanishes silently leaves an operator reading an unnarrowed list as though it were
  narrowed.
- **The envelope is optional-chained and a malformed descriptor is dropped, not thrown on.**
  `meta?.sort?.field`, `meta.query?.fields ?? []`, and a `fields` entry with no `name` is
  filtered out. An older `api` container answers these lists without the new shape, and a
  console that died over its filter bar would take the whole surface down.
- **No client-side re-filtering of an endpoint's rows.** A predicate over the loaded page
  narrows the page, not the list — the same K11 mistake as summing visible rows for a total.
  The three in-memory tables are the exception *because their payload is the whole list*.
- **`aria-sort` on the `<th>`, not on the button.** The sort state is a property of the column;
  a screen-reader user with no arrow has nothing else to read it from.
- **Native input types for the value control.** `type="date"` and `type="number"` — the platform
  already ships the picker, the locale's date order and the mobile keyboard, and a hand-rolled
  date field is a hand-rolled date parser one release later.
- **No inline `style`, no new dependency, px only** (`frontend/AGENTS.md` §1–3). The direction
  arrow is SVG geometry in attributes — `style-src 'self' 'nonce-…'` drops a style attribute in
  production and passes every jsdom test (ADR-W09).
- **Both locales, same commit** (ADR-W05). Field and condition labels are translated, because
  they are now read by a human rather than typed at a parser; the values inside chips fall back
  to the raw string when no key exists, since the envelope may name a field this build has no
  label for yet.
- **Admin density holds** (DESIGN.md §5): one table vocabulary, one filter vocabulary, no new
  chrome above the data.

## Context (anchors)
- `frontend/src/components/admin/filter-builder.tsx` (+ `.module.css`) — **create.** The search
  box (300 ms debounce inside, controlled from outside), the chip list, and the three-select
  `Add filter` row. `<search>`, not `<form>` — nothing is submitted and a form would answer
  Enter with a navigation. Used by all eight tables.
- `frontend/src/components/admin/filter-bar.tsx` (+ `.module.css`) (:W12) — **delete.** Three
  hand-written facet selects, superseded field for field. Keeping it beside the builder would
  give the console two places to narrow a list and two answers to "what is applied".
- `frontend/src/components/admin/sort-header.tsx` (+ `.module.css`) — **create.** Renders the
  whole `<th>`, so no caller can ship the button without `aria-sort` beside it.
- `frontend/src/lib/row-query.ts` (+ `row-query.test.ts`) — **create.** `tokenize`,
  `filterRows`, `sortRows` over rows already in hand, plus `parseQuery` / `serialiseQuery` (the
  builder's two directions) and `fieldDescriptors` (a `RowSpec` seen the way the builder wants
  it). `backend/modules/admin/query-language.ts` stays the authority on the grammar; this is a
  deliberate second implementation.
- `frontend/src/lib/query.ts` (:W02, :W11, :W12) — **modify.** `AdminListMeta` and
  `AdminFilterField` (the echoed envelope), spread into all five page types. No new key: `q`,
  `sort` and `dir` travel in the existing filter bag, so `adminQuery` and `queryKeys.*` already
  carry them.
- `frontend/src/app/[locale]/admin/page.tsx` — **modify.** `FILTER_BAG`, the `meta` pick per
  section, `activeSort`, `onSort`, `onChange`, and `openInterviewsFor` writing a `user:<id>`
  term.
- `frontend/src/components/admin/{interview,call,user,session,audit}-table.tsx` — **modify.**
  `sort` + `onSort` props; sortable columns become `SortHeader`.
- `frontend/src/components/admin/queue-panel.tsx` and
  `frontend/src/app/[locale]/admin/interviews/[id]/page.tsx` — **modify.** The three in-memory
  tables (dead letter, calls, events) get their own `RowSpec`, local state, and the same builder
  over `fieldDescriptors(SPEC)`.
- `frontend/messages/{en,tr}.json` — **modify.** `admin.filter.*`, `admin.op.*`, `admin.field.*`,
  `admin.value.*`, `admin.sort.*`.

  **The trap:** the console's three list-backed sections are three views of **one** list.
  Overview, Interviews and Costs each wrote to their own filter bag under W12's
  `filters[section]`, so a query built on Overview went into a bag the query it renders never
  reads — the control accepted input and nothing happened. One `FILTER_BAG` map fixes it and is
  the better behaviour anyway: a narrowing survives a switch to Costs. The second trap is the
  debounce: the search box holds a draft the query string has not seen yet, so any chip written
  from `value` rather than from the draft silently deletes whatever was mid-word. The third is
  `filterRows`: deciding whether a term is expressible by probing a row confuses "this term is
  meaningless" with "this row has no value for it" — the second must narrow, the first must not
  — and answers wrongly when there are no rows to probe at all.

## Steps
- [x] **1. `AdminListMeta` + `AdminFilterField` in `query.ts`**, spread into the five page
  interfaces.
- [x] **2. `parseQuery` / `serialiseQuery` / `fieldDescriptors` in `row-query.ts`**, with the
  round trip pinned in both directions.
- [x] **3. `filter-builder.tsx`** — debounce, `latest` ref in an effect (`react-hooks/refs`),
  the committed-echo guard so our own round trip does not reset the box mid-word, the chip list,
  the three-select row, per-kind conditions and per-kind value controls.
- [x] **4. `filter-bar.tsx` and its stylesheet deleted**, and every caller moved.
- [x] **5. `sort-header.tsx`** — the whole `<th>`, `aria-sort`, both triangles always drawn,
  geometry in `points`.
- [x] **6. `page.tsx`** — `FILTER_BAG`, `meta` per section, `activeSort` (local bag wins over
  the echo while a re-sort is in flight), `onSort` flips on the same column and starts
  descending on a new one, and `openInterviewsFor` writing `user:<id>` as a term.
- [x] **7. The five tables** take `sort`/`onSort` and swap their sortable `<th>`s.
- [x] **8. The three in-memory tables** (dead letter, drill-down calls, drill-down events), each
  with a `RowSpec` naming the same fields as `specs.ts` and the same builder over it.
- [x] **9. EN/TR copy** for `admin.filter.*`, `admin.op.*`, `admin.field.*`, `admin.value.*` and
  `admin.sort.*`, at parity.
- [x] **10. Tests** — six console cases (a filter built by picking, a chip removed without
  disturbing the words, a typed word reaching the backend, an ignored term warned, a re-sort
  through the backend, one section's query not leaking into another) and `row-query.test.ts`
  covering the grammar and the round trip. Run the `## Verification` commands.

## Definition of done
- Every one of the eight console tables has the same filter builder and at least one sortable
  column, and the builder offers **every** field that table declares.
- Picking a field, a condition and a value produces a removable chip and a request; no syntax is
  typed anywhere, and none is displayed.
- An enum field's value control is a list of the server's own values; a date field's is a native
  date input; a number's is a native number input.
- Words and chips compose one query string: removing a chip leaves the words intact, and typing
  a word leaves the chips intact — including when the word is still inside the debounce window.
- A query reaches the backend as `?q=` on the five endpoint tables and is applied by a predicate
  on the three in-memory ones; nothing re-filters an endpoint's page client-side.
- A term the server ignored is shown as a warning, not dropped.
- Clicking a header re-sorts through the backend and flips direction on a second click; the
  `<th>` carries `aria-sort`.
- "Show me this account's interviews" lands as a visible, removable chip.
- A filter on Model calls does not appear on Users; a filter on Overview survives a switch to
  Costs.
- A response with no `query`/`sort` envelope, or with `fields` as a bare `string[]`, renders the
  console rather than crashing it.
- EN/TR at parity; no inline `style`, no new dependency.

## Verification
```bash
npm test -- --run "frontend/src/app/[locale]/admin"
npm test -- --run frontend/src/lib/row-query.test.ts
npm test -- --run frontend/src/i18n
cd frontend && npx eslint src
```
Expected: 27 admin cases (20 console + 7 drill-down), 23 `row-query` cases, EN/TR parity green,
eslint silent at `--max-warnings=0`.

## Notes

Done 2026-08-11, commit `ba73407`. Repo-wide `npm test` → **1225 passing / 119 files**;
`npm run typecheck`, `npm run lint` and `cd frontend && npx eslint src` all clean.

**Written twice, and why the second one is the one on the branch**
The first version answered the owner's ask with the grammar itself: a `search-bar.tsx` with a
`Syntax` disclosure panel listing the server's fields, and an operator expected to type
`state:completed cost>0.10`. The owner rejected it — a console that must be learned before it
can be used is a console one person uses. The second version keeps the grammar as the wire
format and replaces the typing with `filter-builder.tsx`. The superseded commit is `476d21b`;
it is not on the branch. `search-bar.module.css` survives the rewrite as `sort-header.module.css`
— the sort styles were always in it, and it now has one owner instead of two —
and `sort-header.tsx` came through with one line changed, the import of that stylesheet.

**What exists now**
- `filter-builder.tsx` (484 lines) + `filter-builder.module.css` (172), and `sort-header.tsx` +
  `sort-header.module.css` (191). Both are used by all five list tables, the queue's dead letter
  and the drill-down's two tables.
- `filter-bar.tsx` and `filter-bar.module.css` are **deleted**. The builder covers every field
  the three facets covered and every other one; two narrowing controls over one table is two
  answers to "what is applied".
- `row-query.ts` — `tokenize` / `filterRows` / `sortRows`, plus `parseQuery` / `serialiseQuery`
  / `fieldDescriptors`. `RowSpec<T>` is `{ get, kind }` per field, three kinds only (`text`,
  `number`, `date`): enum validation and the server-side refusals have nothing to protect here,
  every value is already a rendered string. Money arrives as `"0.041200"` and is declared
  `number`, so a `more than 0.01` chip compares values and not text.
- `query.ts` gained `AdminListMeta` and `AdminFilterField` and nothing else — `q`, `sort` and
  `dir` ride the existing filter bag, so `queryKeys.*(filters)` and `adminQuery` carry them with
  no new plumbing.
- `page.tsx` gained `FILTER_BAG`: `overview`/`interviews`/`costs` → `interviews`, everything
  else to itself. `openInterviewsFor` writes `q: user:<id>` rather than a `userId` parameter, so
  the jump from the accounts table arrives as a chip the operator can see and remove.
- Copy: 42 `admin.field.*` labels, 12 `admin.op.*` conditions, 17 `admin.filter.*`, 5
  `admin.value.*`, in both locales.

**Two things fixed en route, both found by the new tests**
- **A chip applied inside the debounce window ate the word being typed.** `write()` composed
  from the last *committed* query string, so "type `ada`, reach for Add filter" lost `ada`. It
  now cancels the timer and composes from the draft, which makes the chip the last write rather
  than a race with it.
- **The console died on a `fields` array of bare strings.** One test fixture still sent
  `fields: ['state']`; `fieldLabel(field.name)` returned `undefined` and `.localeCompare` took
  the whole surface down. A malformed descriptor is now filtered out rather than thrown on —
  the same argument as the optional-chaining on the envelope, because an older `api` container
  is exactly a response without the new shape. That fixture is left as it is, on purpose: it is
  the regression pin.

**Not done, deliberately**
- **A production `next build` was NOT run this session.** The arrow's no-inline-style
  constraint is a decision *about* the production CSP (ADR-W09) that no jsdom test can observe.
- **The acceptance suite was not run** (it needs the compose stack up), and **no `@AC` scenario
  maps the filter** — none maps N03–N06 either. The jsdom cases and both grammar
  implementations' unit tests are the gate.
- No Playwright smoke; the drill-down's and the queue's in-memory filtering are covered by jsdom
  over a mocked fetch only.
- **The three in-memory tables compute `ignored` and do not render it.** The builder cannot
  produce an unknown field, so the only way to reach that array now is a hand-edited query, and
  there is no surface for it on those tables. If the query state ever goes in the URL it becomes
  reachable by paste and needs the warning the endpoint tables already have.
- `queue.deadLetterNoMatch` does not exist: an empty result on the dead letter reuses
  `stats.empty` ("No data yet"). The two facts differ — no job died, versus the filter matched
  none of the ones that did — and a dedicated key would say it better.
- Leftover keys, both locales, referenced by nothing: `admin.search.clear`,
  `admin.search.ignored` (the warning renders `admin.filter.ignored`), `admin.filter.addTitle`,
  `admin.filter.searchLabel` and `admin.filter.searchPlaceholder` (the box uses
  `admin.search.label` / `admin.search.placeholder`). Harmless and at parity; delete them with
  the next copy pass rather than in a commit whose diff is already this size.
- `?active=` on `/admin/sessions` is still accepted by the backend and no longer sent by
  anything: the toggle went with `filter-bar.tsx`, and `active` is a chip now (N06's `computed`
  field).

**Stale doc found, not patched here:** `frontend/DESIGN.md` §5's `Search` row — added by this
task's own first attempt — still describes the `Syntax` panel and a query language the operator
types. DESIGN.md is canonical and owned by the design pass; flagged rather than edited from a
task file, the same way W12 flagged the W11 rows.

**For the next session**
The filter is not in the URL. A narrowed console cannot be linked to or reloaded — the state is
React state per section, exactly as the section selection is (ADR-W10). The builder is already
controlled from outside and the query string is already the whole state, so this is now a
change to `page.tsx` only. It is a coherent follow-up and needs a task.

## Design

Read `frontend/DESIGN.md` §3, §5, §6 before touching CSS. The builder sits **above** the data
and replaces the filter bar in place: it is a control over the table, not chrome in the header
strip. The applied chips sit above the `Add filter` button so the answer to "what is this table
showing" is readable without opening anything, and the builder row is inline conditional
rendering rather than a popover or a dialog — three controls that belong to the bar they sit in,
and a modal over a table hides the thing being filtered. The condition select is disabled, not
hidden, when a kind offers one condition: a row that changes shape as it is used is harder to
learn than one that does not, and the word is still the sentence's verb. `Clear all` appears
only past one chip — with a single chip its own remove button already is "clear all". The
ignored-term warning is `--warning`, never `--danger`: the page loaded and the rows are real;
what is wrong is the operator's belief about them. Both sort triangles are always drawn so an
unsorted column still advertises that it can be sorted, and the active one is a fill change,
not a transform. Focus returns to `Add filter` after a chip is removed or applied, because the
control that had focus is the one that just left the DOM.
