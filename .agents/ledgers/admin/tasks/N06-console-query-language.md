# N06 — One query language behind every console list, and a sort that pages correctly
REPO: (this repo) · Depends: N04, N05 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — a parser on a trust boundary plus cursor correctness under a
variable sort. A whitelist is the only thing standing between a field name on the wire and a
column, and a cursor minted under one order and spent under another lands on a real position in
the wrong list. Both failures are silent, not loud: the page returns `200` and looks right. That
is the opus rule of thumb this ledger already applies to N01 and N03, not the read-endpoint rule
that put N02/N04/N05 on sonnet.

## Goal
Owner's ask:

> "Five tables with a dropdown each. I cannot find one interview by the account that ran it, I
> cannot ask which calls cost more than ten cents, and I cannot sort by anything. And I am not
> learning a query syntax to look at my own data — give me something I click: the field, the
> condition, the value. Every field, not the three somebody picked, and the same control on
> every table. Then let me click a column header."
> — owner, 2026-08-11, walking the console W12 shipped, then rejecting the search box that
> answered it first

This task is the **wire format and the compiler**, not the control. One grammar, compiled per
table against a whitelist, ANDed onto the discrete facets N04/N05 already apply; a sort on any
whitelisted column; a cursor that survives it. W13 builds the point-and-click front that
composes the grammar, which is why the envelope has to describe each field well enough for a
control to be *built* from it, not merely documented. No new table, no migration, no write path.

## Non-negotiables
- **Nothing new is reachable that was not reachable before.** Every field that can be named is a
  line in `specs.ts`. No reflection over the Prisma model, ever — reflection answers
  `password_hash:*` the first time somebody puts it on the query string, and the query string is
  reachable by hand whatever the console renders.
- **The envelope describes fields, it does not just list them.** `query.fields` is
  `{ name, kind, values? }[]`, not `string[]`: a client that knows `state` is an enum with nine
  values can offer those nine and no others, so a control can never propose a value the server
  would refuse. A bare name list forces the client to keep its own copy of the whitelist, and a
  copy drifts the first time a field is renamed.
- **An unknown or unparseable term is reported, never a 422 and never silently dropped**
  (ADR-N08). It comes back in `ignored` and the list is not narrowed by it.
- **The cursor carries the order it was minted under** (ADR-N09). A cursor from another sort is
  dropped and the caller gets page one.
- **The order is always total.** `compileSort` appends `id` to every `orderBy`, whatever the
  sort field — an order with ties has no single position for a cursor to seek to.
- **Facets and query AND together.** A dropdown and a compiled term are two halves of one
  question; honouring one silently drops the other.
- **Every field the operator can see is filterable through the same door.** A control that
  covers fourteen fields out of fifteen is a control an operator stops trusting; the fifteenth
  is `sessions.active`, which is two columns and a clock, so the compiler grows a `computed`
  kind rather than the console growing a second mechanism beside it (ADR-N11).
- **The clock is the caller's, never `new Date()` inside the compiler.** The acceptance ring
  moves a fixed clock; a real-clock comparison buried in a leaf would never see it move, and
  `sessions.ts` already threads `clock.now()` for exactly this reason.
- **Nothing throws on a hostile query string** — the N04/N05 rule, now across a parser that
  takes free text. `Prisma.Decimal` throws on garbage; a thrown parse is a 500 on a string that
  arrived from a link somebody pasted.
- **The K11 fields and every N01–N05 response field survive.** `items` and `nextCursor` keep
  their shape and their meaning; `query` and `sort` are additions beside them.
- **No aggregation moves into Node.** The search compiles to a Prisma `where`, not to a filter
  over a fetched page — a page-local filter narrows the page, not the list.

## Context (anchors)
- `backend/modules/admin/query-language.ts` — **create.** `tokenize` (a scan, not a regex: an
  unclosed quote degrades into the rest of the line), `parseTerm` (`>=|<=|:|>|<`, longest
  first), `compileQuery(input, spec, now)` → `{ where, applied, ignored }`, `compileSort` →
  `{ field, dir, orderBy }`, `encodeListCursor` / `decodeListCursor`. Eight `FieldKind`s; the
  eighth, `computed`, is built by the spec's own `build(value, now)` because it is not a leaf on
  one path.
- `backend/modules/admin/specs.ts` — **create.** `INTERVIEW_SPEC`, `CALL_SPEC`, `USER_SPEC`,
  `SESSION_SPEC`, `AUDIT_SPEC`: field name → `{ path, kind, values?, build? }`, `freeText`,
  `sortable`, `defaultSort`, and `sortOverrides` for the one thing Prisma can order by and
  cannot filter on. The field name is short (`cost`, not `spent_usd`) — the column is the
  schema's business, and the name is what the console labels.
- `backend/modules/admin/list.ts` — **create.** `listParams(query, spec, now)`, `findManyArgs`,
  `listEnvelope`. `take: limit + 1` is the whole next-page mechanism; the envelope echoes
  `query.{applied,ignored,fields}` and `sort.{field,dir,sortable}`, with `fields` as
  `FieldDescriptor[]`.
- `backend/modules/admin/{interviews,llm-calls,users,sessions,audit-log}.ts` — **modify.** Each
  keeps its own `where` shape, `include` and projection, and gains
  `{ ...existingFilters(req.query), ...params.search.where }`. `sessions.ts` passes
  `clock.now()` into `listParams` and keeps its `?active=` parameter beside the new field.
- `backend/modules/interview/cursor.ts` (:N01) — `pageLimit` stays; `encodeCursor`/`decodeCursor`
  are replaced **on the admin lists only**. `/me/interviews` has one order and keeps them.
- `backend/modules/admin/query-language.test.ts` — **create.** The grammar, the whitelist, the
  computed field against a fixed clock, the totality of the order and the cursor's
  order-sensitivity.

  **The trap:** Prisma resolves a cursor by seeking to that row's position **in the given
  order**. A `created`-desc cursor handed to a `cost`-asc query does not error and does not
  return nothing — it finds a real position in a list nobody asked for and pages from the
  middle of it. The cursor must therefore carry its order, and the order must be total or the
  position is not unique either. The second trap is `interviews>5`: it was in the owner's first
  wording and it is not honestly buildable as a filter (see ADR-N10), so it is not a field at
  all — sort-only, and reported if a term names it. The third is `active`: writing it as a leaf
  on `expires_at` loses the `revoked_at` half, and writing it against `new Date()` loses the
  acceptance ring's clock.

## Steps
- [x] **1. `query-language.ts`** — `tokenize`, `parseTerm`, `leafFor` per `FieldKind`,
  `compileQuery` ANDing every term (bare words OR across `freeText`, then AND in).
- [x] **2. `specs.ts`** — the five whitelists; `USER_SPEC.sortOverrides.interviews`.
- [x] **3. `compileSort`** — whitelist-checked field, `asc` or else `desc`, `id` appended.
- [x] **4. `encodeListCursor` / `decodeListCursor`** — `base64url(sort:dir:id)`; a mismatch,
  a malformed token or a non-cuid id all return `undefined`.
- [x] **5. `list.ts`** — `listParams` / `findManyArgs` / `listEnvelope`, and the
  `FieldDescriptor[]` + `sortable` echo, so the console's controls are the backend's whitelist
  rather than a copy of it.
- [x] **6. All five lists** onto it, each ANDing its existing facets with `params.search.where`;
  the applied terms go into the read's `audit_logs.metadata` beside the filters.
- [x] **7. The `computed` kind** — `FieldKind` gains it, `FieldSpec` gains `build(value, now)`,
  `compileQuery` takes `now` and `listParams` threads the caller's clock; `SESSION_SPEC.active`
  is the one field that uses it.
- [x] **8. Tests** — `query-language.test.ts`: the grammar, `password_hash:*` reaching no
  column, every declared field parsing, the computed field both ways against a fixed clock,
  `id` ending every order, the cursor refused across a re-sort.
- [x] **9. Run the Verification commands.**

## Definition of done
- One grammar answers all five lists: bare word, `"quoted phrase"`, `field:value`, trailing `*`
  prefix, `field>value` / `<` / `>=` / `<=` on numbers, decimals and dates. Terms AND.
- `password_hash:*` and `google_sub:x` compile to `{}` and come back in `ignored`.
- An unknown field, an out-of-enum value, an uncomparable kind and an unparseable
  number/decimal/date are all `ignored`; none is a 422 and none narrows the list.
- `query.fields` carries a kind per field and the exact value set for every enum, so a client
  can build a typed control and an enum dropdown with no local copy of the whitelist.
- `active:true` on `/admin/sessions` compiles to `revoked_at: null` AND `expires_at > now`, and
  `active:false` to the OR of their negations — against the clock the caller passed in, not the
  process clock.
- Every list's `orderBy` ends in `{ id: dir }`, for every sortable field on every spec.
- A cursor minted under one `sort`/`dir` is refused by any other; the caller gets page one.
- `interviews>5` on `/admin/users` comes back ignored; `?sort=interviews` orders by the
  relation count natively.
- Every endpoint still returns `items` + `nextCursor` unchanged in shape, plus `query` and
  `sort`; the dropdown facets still narrow, ANDed with the query.

## Verification
```bash
npm test -- --run backend/modules/admin
npm run typecheck
npm run lint
```

Expected: `backend/modules/admin` green, typecheck and lint silent.

## Notes

Done 2026-08-11, commit `d443bad`. `npm test` → **1225 passing / 119 files** (repo-wide);
`backend/modules/admin` alone is 7 files / 71 tests, of which `query-language.test.ts` is 33.
`npm run typecheck`, `npm run lint`, `cd frontend && npx eslint src` all clean.

**What exists now**
- `query-language.ts` — `tokenize`/`parseTerm`/`compileQuery`/`compileSort` +
  `encodeListCursor`/`decodeListCursor`. Eight `FieldKind`s: `text`, `exact`, `enum`, `number`,
  `decimal`, `date`, `presence`, `computed`.
- `specs.ts` — five `TableSpec`s. `INTERVIEW_SPEC` 15 fields / 8 sortable, `CALL_SPEC` 15 / 7,
  `USER_SPEC` 9 / 4, `SESSION_SPEC` 8 / 3, `AUDIT_SPEC` 8 / 3.
- `list.ts` — `listParams`, `findManyArgs`, `listEnvelope`, `FieldDescriptor`. The five handlers
  lost their `take: limit + 1` / `slice` / `encodeCursor` copies.
- Four ADRs: **N08** ignored-not-422, **N09** order-carrying cursor, **N10** `interviews>N`
  sort-only, **N11** the `computed` kind.

**Written twice, and why the second one is the one on the branch**
The first version of this task shipped the grammar as the *interface* — the console got a
search box and a syntax panel, and an operator had to type `state:completed cost>0.10`. The
owner rejected it: a console that has to be learned is a console that gets used by one person.
The grammar survives that rejection intact because it was never the problem — it is a good wire
format, it is one place where a field name is checked against a whitelist, and it is what makes
a filter linkable. What changed here is that the envelope now describes fields instead of
listing them, and that the one field the grammar could not express grew a kind rather than
staying a parameter on the side. The superseded commit is `cc38127`; it is not on the branch.

**Decisions inside the grammar, not big enough for an ADR**
- `created:2026-08-11` is the **day**, not the instant midnight — equality against a timestamp
  matches nothing, which reads as "no such rows" rather than "wrong question".
- A bare word is a `contains` even on an `exact` field: an id column answers `id:<cuid>`
  exactly and is still worth a partial match when a word is typed loose.
- `parseTerm` requires a non-empty value, so `ada@example.com` and `state:` are bare words
  rather than a lookup on the field `ada@example`.
- `{ equals: null }`, never a bare `null` — Prisma reads a bare null as "no filter", which
  would turn `deleted:false` into "every row".
- `computed` carries `values: ['true','false']` even though `build` is what does the work: the
  values are what lets the console offer a two-option dropdown instead of a free text box.
- `?active=true` stays on `/admin/sessions` beside `active:true`. It is one line in
  `sessionFilters`, nothing in the console sends it since W13 deleted the toggle, and removing
  a documented query parameter is a breaking change for a gain of one line.

**Not done, deliberately**
- **No `@AC` scenario maps the query language.** `COVERAGE.md` maps none of N03–N06;
  `query-language.test.ts` is the gate, same as N04/N05.
- **`npm run test:acceptance` was NOT run this session** (needs the compose stack).
  `@AC-17`/`@AC-18` read only fields this task preserved — read from the feature file, not
  proven by a run. Run it before the PR.
- **No production `next build` this session either** — this task ships no UI, but W13 does and
  the same PR carries both.
- No `OR`, no parentheses, no negation. Nobody asked, and a grammar with precedence is a
  grammar with a precedence bug.
- `computed` has exactly one instance and no second candidate. It is not a plugin system: a
  second one would be another eight lines in a spec, and a third would be the moment to ask
  whether the schema is missing a column.
- No integration test over a live Postgres: the `where` trees are asserted structurally, so a
  Prisma-side rejection of one would surface only at runtime. The `computed` builder is the
  most exposed to this, because it is the only one that emits a two-key object of its own.

**For a future task**
Sorting on a non-indexed column is now reachable from the console's header row — `occupation`,
`account`, `action` all sort and none has an index. The `llm_calls(interview_id, created_at)`
composite in the STATE backlog is joined by that: promote both together as one additive
migration rebased on F02 if a console list gets slow.
