---
task: W13
author: Sezai
sessions: [2026-08-11]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 2
tools: [ponytail, caveman]
---

## Session 1 — 2026-08-11

### What I asked for / what came back
- A search box and sortable headers on all eight console tables, against N06's envelope. Came
  back as two components, one library and eight tables wired; the shape was right and the two
  things it got wrong were both about state that is shared without looking shared (below).
- Asked whether the grammar could be one module imported by both sides. It could not, honestly:
  the backend compiles to a Prisma `where` and the client to a predicate, so the only common
  part is the ~25-line tokenizer. Kept as a second implementation with mirrored tests, and the
  reason written into `row-query.ts`'s header so it does not get "fixed" later.
- **Then the owner rejected the whole interface**, which is iteration 2 and most of this entry.

### Methodology trace
Owner's console walkthrough → cases in `admin/page.test.tsx` (query reaches the backend,
ignored term warned, header re-sorts and flips, one section's query stays put) plus
`row-query.test.ts` mirroring the backend's grammar cases → red → green. Owner reviews the
running console, rejects the search box → the syntax cases are rewritten as builder cases (pick
a field, pick a value, apply; remove a chip and keep the words) and two new bugs fall out of
them → green again. 27 admin cases (20 console + 7 drill-down), 23 `row-query`, repo-wide 1225
passing; `npx eslint src` silent. The load-bearing case is still the section-isolation one: it
is what caught the shared-bag bug.

### Friction
- **Overview, Interviews and Costs render one list and each wrote to its own filter bag.**
  W12's `filters[section]` versus `useAdminInterviews(…, filters.interviews)` — so a query built
  on Overview went into a bag nothing read and the control silently did nothing. `FILTER_BAG`
  maps the three onto `interviews`, which is also the better behaviour: a narrowing survives the
  switch to Costs. Found by the new test, not by looking.
- **The envelope had to be optional-chained.** `meta.sort.field` read directly crashed the page
  against every stubbed fixture that predated the new fields — which is exactly what an older
  `api` container is. A console that died over its filter bar would take the whole surface down,
  so `meta?.sort?.field` and `meta.query?.fields ?? []`.
- **`filterRows`'s expressibility check probed row zero in the first version.** That confuses
  "this term is meaningless" with "this row happens to have no value for it" — the second must
  narrow, the first must not — and has no answer at all when the table is empty. Made
  row-independent; the empty-table test is what surfaced it.
- **The debounce fought its own echo.** A 300 ms commit hands `value` back through the caller
  while the user is still typing, and the naive `useEffect([value])` reset the box to the
  prefix. A `committed` ref holds what this box last sent, and only a value it did not send
  resets the draft.
- `react-hooks/refs` again, same rule as W10 and W12: the "latest props" ref cannot be assigned
  during render. Root `npm run lint` is still not the gate — `npx eslint src` is.

### What I rejected and rewrote by hand
- **A CSS-transform arrow** — one triangle glyph rotated 180°. It needs a style attribute, and
  `style-src 'self' 'nonce-…'` drops those in production while jsdom passes happily (ADR-W09,
  the same trap that killed recharts). Rewritten as two `<polygon>`s with their geometry in
  `points`, both always drawn so an unsorted column still advertises that it can be sorted.
- **A `<button>` with `aria-label` and no `aria-sort`.** The label replaces the contents
  wholesale and swallows the state, and sortedness is a property of the column, not of the
  control. `SortHeader` renders the whole `<th>` so no caller can ship one without the other.
- **Client-side filtering of the endpoint tables.** It narrows the page, not the list: the same
  K11 mistake as summing the visible rows for a platform total, one layer over. Only the three
  tables whose payload *is* the whole list (drill-down calls and events, the dead letter) filter
  in the browser, and their row counts are bounded at 500 / 200 / 20 by the endpoints.
- **A cursor cleared by hand on every sort click.** Unnecessary twice over: the sort is in the
  query key, so a new order is a new cache entry starting at page one, and N06's backend refuses
  a cursor minted under a different order anyway. Deleted the reset.
- **`cost` declared as text in the drill-down's `RowSpec`.** Money is a six-decimal string on
  the wire, and a `more than 0.1` comparison against a string is lexicographic — confident and
  wrong. Declared `number`; the test pins it.

### Iteration 2 — the owner rejected the search box
The first version was the grammar made visible: `search-bar.tsx`, a 300 ms debounce, and a
`Syntax` disclosure listing the server's `query.fields` so an operator could look up what to
type. It is defensible on every axis except the only one that mattered — the owner opened it,
read the panel, and said they were not going to learn a syntax to look at their own data. That
is right, and the tell was already in the design: a control whose first job is to explain itself is
a control that failed. Documentation next to an input is an admission that the input is wrong.

What replaced it is `filter-builder.tsx`: a plain box for words, and an `Add filter` row of
three selects — field, condition, value — that emits a removable chip. What did **not** change
is the query string. The chips and the words serialise to exactly what the old box accepted, so
the backend, the request URL and any link that carries a query are untouched; only the typing is
gone. That is why the reversal cost one commit rather than a re-plan: N06's grammar was never
the thing being rejected, it was the thing being exposed.

**Why the string stayed the single source of truth.** The obvious build is chips in one state
and words in another, joined at request time. That gives two states that can disagree, and there
is no correct answer when they do — and it gives a query arriving from a link nowhere to land
except back into raw syntax the operator has to read. One string, with `parseQuery` /
`serialiseQuery` as exact inverses pinned in both directions, means a restored query arrives as
chips and every control is a view rather than a copy.

**Two bugs the builder's own tests caught, both from that one string:**
- **A chip applied inside the debounce window ate the word being typed.** `write()` serialised
  the last *committed* words and discarded the input's draft: type `ada`, reach for `Add filter`,
  lose `ada`. It now cancels the pending timer and composes from the draft, which also makes the
  chip the last write rather than a race against a timer that is about to fire.
- **A `fields` array of bare strings took the console down.** One test fixture still sent
  `fields: ['state']` from the old envelope; `fieldLabel(field.name)` returned `undefined` and
  the `.localeCompare` that sorts the field list by its translated label threw. Now a descriptor
  with no `name` is filtered out rather than thrown on — the same argument as the existing
  optional-chaining, because an older `api` container answers precisely like that fixture. The
  fixture stays as it is: it is the regression pin.

**What I rejected in the second version:**
- **Keeping `filter-bar.tsx` beside the builder** — three familiar facets plus a general
  control. Two places to narrow one table, two answers to "what is applied", and the facet bar
  covering three fields out of fifteen was the original complaint. Deleted, callers moved.
- **A modal or a popover for the three selects.** A dialog over a table hides the rows being
  filtered, and it traps focus for a control the operator is going to use four times in a row.
  Inline conditional rendering, and focus returns to `Add filter` after apply or remove, because
  that button is the one thing on screen that did not just disappear.
- **A hand-built date picker and a text box for numbers.** `type="date"` and `type="number"`
  ship the picker, the locale's date order and the mobile keyboard for free; a custom one ships
  a custom date parser a release later.
- **A free-text value box for enums.** The envelope carries the exact values (that is what N06's
  `FieldDescriptor` is for), so the control offers those and nothing else — a dropdown that can
  propose a value the server refuses is a dropdown that produces an `ignored` term for a click.
- **Hiding the condition select when a kind offers one condition.** A row that changes shape as
  you use it is harder to learn than one that does not, and `is` is still the sentence's verb.
  Disabled, not hidden.
- **Translating the field names.** They were untranslated in the first version on purpose —
  they were identifiers the parser matched on. In the builder nobody types them, so they are
  labels read by a human and they are translated, all 42 of them in both locales. The raw name
  is the fallback rather than an error: the envelope is the server's whitelist and may name a
  field this build has no string for yet, and a field the operator cannot see is worse than one
  labelled in English.
- **A `userId` parameter for "show me this account's interviews".** It filtered the next screen
  invisibly. It writes a `user:<id>` term now, so the jump lands as a chip that can be seen and
  removed — an operator who does not know a list is narrowed will eventually read it as if it
  were not.
