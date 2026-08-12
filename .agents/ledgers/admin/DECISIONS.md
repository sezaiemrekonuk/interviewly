# Admin — Decisions (append-only ADR log)

Never edit past entries. Supersede with a new dated entry referencing the one it changes.
Prefix `ADR-N` to avoid collision with foundations (`ADR-F`), auth (`ADR-A`), and
interview-core (`ADR-I`). Referenced back into `PLAN.md`.

---

## ADR-N01 — 2026-07-30 — `requireAdmin` middleware chokepoint over per-handler role checks

**Context:** Every `/admin/*` route must be reachable only by a `role = 'admin'` account,
and a non-admin must receive `403 FORBIDDEN` (backend spec *Admin module*; `admin_cost.feature`
@AC-18). Options: (A) a `requireAdmin` middleware layered after `requireAuth` on the admin
router, one gate for the whole surface; (B) an inline `if (req.user.role !== 'admin')` check
at the top of each admin handler; (C) a role claim baked into the session lookup so
`requireAuth` itself refuses non-admins on admin routes.

**Decision:** (A). `requireAdmin(req, res, next)` runs after `requireAuth` (which has already
attached `req.user`), checks `req.user.role === 'admin'`, and returns `403 FORBIDDEN` from the
F01 registry otherwise. It is mounted once on the `modules/admin/router.ts` so every current
and future `/admin/*` route inherits the gate.

**Why not per-handler checks:** Five handlers copy-pasting the same guard is five chances for
one to be forgotten when a sixth admin route is added — exactly the drift a single chokepoint
prevents. The `admin_cost.feature` @AC-18 assertion is a whole-surface property, not a
per-handler one.

**Why not folding it into `requireAuth`:** `requireAuth` is auth A01's, shared by every
protected route in the app (interview, report, voice). Teaching it about admin roles couples
a general-purpose gate to one module's authorization policy; the admin role check belongs in
the admin module.

**Consequences:** `requireAdmin` depends on `req.user` already being set — it is always
mounted *after* `requireAuth`, never standalone. The gate is authored and its allow path
exercised in N01 (an admin reads `/admin/interviews` in @AC-17); its deny path (non-admin →
403) is asserted by @AC-18 in N02. Both scenarios re-run the gate, so a regression surfaces
in either.

---

## ADR-N02 — 2026-07-30 — Admin reads bypass the soft-delete helper, annotated at each call site

**Context:** K11 requires admin metrics to count deleted interviews ("Total tokens …
deleted interviews included") and `GET /admin/interviews` to list them with a `deleted` flag
(`admin_cost.feature` @AC-17). But the K13 repository-helper contract says user-facing modules
must go through `userInterviews()`/`activeInterview()`, which bake in `deleted_at IS NULL`.
Options: (A) admin reads call `prisma.interview.findMany` directly, bypassing the helper, with
a comment at each call site marking the deliberate bypass; (B) add a second helper variant
(`allInterviews()`) that includes deleted rows; (C) a boolean flag on `userInterviews`.

**Decision:** (A). The admin module calls `prisma.interview.findMany` directly (no
`deleted_at` filter), and every such call carries a comment:
`// ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted)`.
This is the *only* sanctioned direct `findMany` in the codebase (db spec: "Admin/analytics
reads … bypass the helper deliberately and say so at the call site").

**Why not a second helper:** An `allInterviews()` helper alongside `userInterviews()` invites
a user-facing module to reach for the wrong one — the very leak K13's single-helper discipline
exists to prevent. The db spec explicitly prescribes the annotated bypass, not a parallel
helper.

**Why not a flag:** A `userInterviews(userId, { includeDeleted })` boolean makes the leak a
one-argument mistake and blurs the audit boundary; a distinct annotated call site is greppable
and unambiguous in review.

**Consequences:** Every admin read is grep-auditable by the `ADMIN AUDIT` comment. If a future
user-facing module copies the pattern, review catches it — the comment is a red flag outside
`modules/admin/`. The soft-delete leak (deleted interview appearing in `GET /me/interviews`)
remains a 5-point regression the acceptance ring guards (@AC-17).

---

## ADR-N03 — 2026-07-30 — Soft delete is `UPDATE deleted_at`, and the delete/list routes reuse I03

**Context:** interview-core delegated `DELETE /interviews/:id`, `GET /me/interviews` and the
history read to this ledger (interview-core PLAN *Out of scope*: "`DELETE`/list/history green
runs — `admin` ledger"). `admin_cost.feature` @AC-17 asserts: a non-owner deleting → `404
INTERVIEW_NOT_FOUND`; the owner deleting → `204`; the interview then absent from
`GET /me/interviews` but present in `GET /admin/interviews` with `deleted: true` and unchanged
cost. Options for building delete + list: (A) reuse interview-core I03's ownership resolver
(`activeInterview` + `user_id` check) and CSRF middleware, adding only the two thin handlers;
(B) build a fresh ownership check in the admin module.

**Decision:** (A). `DELETE /interviews/:id` mounts on I03's `modules/interview/router.ts`
behind the existing `:id` ownership resolver (non-owner or already-deleted → `404
INTERVIEW_NOT_FOUND`) and the existing CSRF middleware (it is a state-changing route), and its
handler performs `prisma.interview.update({ where: { id }, data: { deleted_at: new Date() } })`
— never a hard `DELETE` (db spec Behaviour §1). `GET /me/interviews` calls
`userInterviews(req.user.id)` (deleted excluded by the helper), paginated by cursor.

**Why not a fresh ownership check:** Duplicating the resolver is a second place for the
existence-not-leaked rule (`404`, never `403`) to drift from I03's. The ownership boundary is
already built, tested (ADR-I11) and mounted as `:id` param middleware — the delete route
inherits it for free.

**Consequences:** These two routes live in `modules/interview/` (they are interview routes),
authored by this ledger but mounted on I03's router — adding a route line and two files is not
a structural schema change and does not conflict with F02's freeze. The cost stays "unchanged"
after delete because a soft delete touches only `deleted_at`; `spent_usd` and the `llm_calls`
rows are untouched, which the admin audit list reads back verbatim.

---

## ADR-N04 — 2026-07-30 — `admin_auth.feature` is owned by auth A02, not by this ledger

**Context:** `admin_auth.feature` holds one scenario, `@AC-4` "Admin accounts can sign in only
with password", which asserts an admin completing Google sign-in is refused `403
ADMIN_MUST_USE_PASSWORD` with no session, then signs in with a password successfully. The
admin-must-use-password rule is a K8 security requirement checked twice (Google callback +
session issuance). The question: does the admin ledger implement any slice of `admin_auth.feature`?

**Decision:** No. Auth **A02** implements the admin-password rule and keeps `admin_auth.feature`
green (its verification is `@AC-4 or @AC-5`; see `.agents/ledgers/auth/tasks/A02-google-oauth-
admin-restriction.md` and `.agents/ledgers/auth/STATE.md`). This ledger builds **no**
admin-auth task and owns **`admin_cost.feature` only**. It consumes the admin session A02's
password sign-in produces (the acceptance step "an admin user has a session" signs the admin in
with a password via A02's login path).

**Why not split a slice here:** The rule is a single defence checked at two points inside the
auth trust boundary; a second implementation in the admin module would be a divergent copy of a
security-critical check — precisely the double-ownership that lets one copy rot while the other
is patched.

**Consequences:** The admin ledger's cross-ledger table lists A02 as a dependency (an admin must
be able to obtain a session before any `/admin/*` test runs), not as work this ledger performs.
If A02 is not green, admin tasks block on it (STATE cross-ledger gate), never re-implement it.

---

## ADR-N05 — 2026-08-11 — US-29's events land in the existing `audit_logs`, not a new table

**Context:** US-29 asks an admin to "see when the system defended itself". Prompt-injection
suspicions existed only as a pino line in `packages/ai/src/prompt-builder.ts`; budget and time
exhaustion left only `interviews.ended_reason`, one value per interview and not a timeline.
`LOG_TRANSPORT=stdout` with no log volume on `api` means `docker compose down` erased both.
Options: (A) three new `AuditAction` values on `audit_logs`; (B) a dedicated `events` table;
(C) leave it to `LOG_TRANSPORT=elastic` and query Kibana.

**Decision:** (A). `security.prompt_injection_suspected`, `interview.budget_exhausted`,
`interview.time_exhausted`. No migration — `audit_logs.action` is a `String` by design, so a
new action is a compile-time change to the union in `src/lib/audit.ts`.

**Why not a dedicated `events` table:** It is `audit_logs` with a different name — actor,
subject, trace id, metadata, append-only — and a structural change belongs to F02, not here
(ADR-F02). Two tables also mean the drill-down does two queries and merges two orderings to
show one timeline.

**Why not Elastic:** it is an optional profile (~2.7 GB), off by default. A story about seeing
what happened cannot depend on an observability stack a fresh clone does not run.

**Consequences:** The actor on these rows is the interview's own account, not an operator —
nobody privileged is present, and the row still answers "whose data was this". The drill-down
(N04) queries `subject_type = 'interview'` + `subject_id`, never `action`, so admin list reads
do not crowd the timeline.

---

## ADR-N06 — 2026-08-11 — The security sink is an injected callback, not a Prisma import

**Context:** The scan that emits `SECURITY_PROMPT_INJECTION_SUSPECTED` lives in
`packages/ai`, which depends on neither `api` nor `worker` (K1) and owns no database. ADR-N05
needs that suspicion to reach `audit_logs`. Options: (A) `packages/ai` exports a
`SecurityEventSink` type and takes one optionally, the caller supplies the durable half;
(B) import Prisma in `packages/ai` and write the row there; (C) re-scan in `backend` after the
build so the package stays untouched.

**Decision:** (A). `PromptBuilder` takes an optional fourth constructor arg,
`createPromptBuilder({ logger, onSecurityEvent })` threads it, `ChainDeps.onSecurityEvent`
carries it through the chain. `backend/modules/ai/index.ts` supplies `recordSecurityEvent`;
`worker` and every test pass nothing and keep the log-only behaviour.

**Why not a Prisma import:** it would give a package the whole repo depends on a dependency on
one deployment's database, and make the worker and the unit tests need a connection to build a
prompt.

**Why not re-scanning in `backend`:** two copies of a security check, drifting apart. The
pattern set and the scan stay in one place.

**Consequences:** The sink is fire-and-forget by contract — the scan does not block a call
(§7.1.5), so a sink that could fail a build would hand the regex a veto it deliberately does
not have. It carries the field NAME and the pattern id only; the matched value is the
candidate's text and must not reach a durable table (issue 063).

---

## ADR-N07 — 2026-08-11 — The console's "Sessions" section means auth sessions

**Context:** The admin console was specced with a "Sessions" section, sketched when a voice
*session* was a first-class row. ADR-S01 removed the ElevenLabs agent and the `voice_sessions`
table with it, so that reading has no table behind it. Options: (A) the section lists the auth
`sessions` rows; (B) drop the section; (C) reconstruct voice sessions from `llm_calls` with
`unit_kind = 'second'`.

**Decision:** (A). `GET /admin/sessions` reads the AUTH `sessions` table — who currently holds
a way in, and when it lapses — filtered by `userId` and `active`. `active` is computed
server-side against `clock.now()`, because a browser with a wrong clock would draw a different
answer. The session id is projected: it is a row's primary key, not the signed cookie value.

**Why not drop it:** "who is signed in right now, and whose access can be revoked" is the
question an operator actually opens a sessions view with, and nothing else in the console
answers it.

**Why not reconstruct voice sessions:** that is a per-call cost view, which is what
`GET /admin/llm-calls` and the N04 drill-down already are. Naming it a session would invent an
entity the schema no longer has.

**Consequences:** The section's name is inherited and now means something narrower than it did
when it was written. Recorded here so a later reader does not go looking for the voice-session
table that ADR-S01 deleted.

---

## ADR-N08 — 2026-08-11 — An unparseable search term is reported, never a 422 and never dropped

**Context:** N06 puts one compiled query behind five console lists. W13's builder composes most
terms from the envelope's own field descriptors, so the well-formed case is well-formed by
construction — but the query string is a query string: a bare word typed into the search box, a
link minted before a field was renamed, a hand-edited URL, or any client that is not this
console can all deliver a term the compiler cannot honour. Those are exactly the terms no
control vouched for. Options: (A) unknown or unparseable terms come back in an `ignored` array
and do not narrow; (B) `422 VALIDATION_ERROR` on the first term the grammar cannot compile;
(C) drop them silently and answer with whatever the rest of the query meant.

**Decision:** (A). `compileQuery` returns `{ where, applied, ignored }`; the envelope carries
all three and the console shows `ignored` as a warning. Nothing about a term makes the request
fail.

**Why not 422:** one stale term becomes a failed page. The operator loses the rows they already
had and learns nothing about which of five terms was wrong — and a link that worked last month
becomes an error rather than a list with one chip missing.

**Why not silent:** the dangerous one. A dropped term looks exactly like a filter that matched
everything, so the operator reads an unnarrowed list believing it is narrowed — on the surface
whose whole job is being right about money and deletions.

**Consequences:** `ignored` is part of the contract, not decoration: a client that does not
render it reintroduces (C). `leafFor` returning `null` is the single mechanism — an unknown
field, an out-of-enum value, a comparison on an unordered kind, a `computed` field whose `build`
declines, and a `Prisma.Decimal` that throws all land in the same place. The better the client's
controls get, the rarer a non-empty `ignored` becomes and the more it means when it appears: on
the console today it reads as "this query is older than this schema".

---

## ADR-N09 — 2026-08-11 — The list cursor encodes the order it was minted under

**Context:** N01's admin cursor is `base64url(id)` and every list had exactly one order, so the
id was enough. N06 makes the order a request parameter. Prisma resolves a cursor by seeking to
that row's position **in the given order**. Options: (A) `base64url(sort:dir:id)`, refused when
it does not match the current order; (B) keep `base64url(id)` and trust the client to drop the
cursor when it re-sorts; (C) offset paging, where a page number is order-independent.

**Decision:** (A). `encodeListCursor(id, sort)` / `decodeListCursor(value, sort)`; a mismatched
`sort` or `dir` returns `undefined`, which means page one. Companion invariant: `compileSort`
always appends `id`, because an order with ties has no single position to seek to.

**Why not trusting the client:** a `created`-desc cursor handed to a `cost`-asc query does not
error and does not return nothing — it finds a real position in a list nobody asked for and
pages from the middle of it. Silence again, and this time the rows themselves are wrong.

**Why not offset paging:** it re-reads rows on every page over tables that are being written
while they are read, and N01 chose cursors for that reason (`modules/interview/cursor.ts`).

**Consequences:** re-sorting returns to page one, which is what clicking a column header means
anyway. `/me/interviews` and `/me/questions` keep the plain `encodeCursor`/`decodeCursor` — one
order each, nothing to mismatch. An admin cursor is now only valid inside one ordering, so it
must not be persisted anywhere across a sort change.

---

## ADR-N10 — 2026-08-11 — `interviews>N` on the users list is sort-only, not filterable

**Context:** "users who ran more than five interviews" was offered as an example when N06 was
scoped. Prisma has no count predicate in `where` — `_count` exists in `select` and in
`orderBy`, not as a filter. Options: (A) the term is ignored and the relation count is
sortable only; (B) two queries — ids from a raw `GROUP BY … HAVING`, then
`where: { id: { in: [...] } }`; (C) fetch users with `_count` and filter in Node.

**Decision:** (A). `USER_SPEC.sortable` includes `interviews` through
`sortOverrides: { interviews: (dir) => ({ interviews: { _count: dir } }) }`, which is native.
`interviews>5` as a *term* comes back in `ignored` (ADR-N08).

**Why not the two-query workaround:** an unbounded `id: { in: … }` list against a table that
only grows, and a second query whose cost is invisible from the endpoint's shape. A filter that
degrades silently at scale is worse than one that says it does not exist.

**Why not filtering in Node:** it narrows the page, not the list — the page would come back
short and the next cursor would still be right, so the count on screen would be nonsense.

**Consequences:** `sortOverrides` exists for exactly this shape — orderable but not filterable
— and is empty on the other four specs. `interviews` is deliberately **not** a line in
`USER_SPEC.fields`, so it is absent from the echoed descriptors and the console's filter builder
cannot offer it: the field list an operator sees is exactly the field list that filters. The
`ignored` path is therefore reached only by a query string written by hand, which is the one
place the honest answer still has to be given rather than designed away. If a count filter is
ever really needed it is a materialised `users.interview_count` column, which is an F02
migration, not an admin change.

---

## ADR-N11 — 2026-08-11 — `computed` is a field kind, so `active` filters through the same door as every other field

**Context:** an auth session is "active" when it is neither revoked nor past its expiry:
`revoked_at IS NULL AND expires_at > now`. Two columns and the server's clock, so no `FieldSpec`
of the `{ path, kind }` shape can express it — a leaf is one condition on one path. It shipped
as a dedicated `?active=true` query parameter (N05) with a matching toggle in W12's filter bar,
which was fine while the console narrowed lists with hand-written facets. W13 replaces those
facets with one builder driven entirely by the envelope's field descriptors, and a builder that
covers fourteen of a table's fifteen fields is a control an operator learns to distrust: the
fifteenth is invisible, so they stop believing the list is narrowed the way it says it is.
Options: (A) `FieldKind` gains `computed` and `FieldSpec` gains `build(value, now)`, which
returns the whole condition; (B) keep `?active=` and give the console a second, bespoke control
beside the builder; (C) store `active` as a real column, maintained by a job.

**Decision:** (A). `SESSION_SPEC.active` is `{ kind: 'computed', values: ['true','false'],
build }`, and `build` returns `{ revoked_at: null, expires_at: { gt: now } }` or the OR of their
negations. `compileQuery(input, spec, now = new Date())` takes the clock and `listParams` threads
the handler's `clock.now()` into it; `leafFor` refuses `computed` outright, so the whole
condition can only come from `build`. A value `build` will not accept, and any comparison
operator, are `ignored` (ADR-N08). `?active=` stays accepted on `/admin/sessions` — one line in
`sessionFilters`, and removing a documented parameter is a breaking change for no gain.

**Why not a second control beside the builder:** it is the state the console was already in, and
it is the state the owner rejected. Two narrowing mechanisms over one table give two answers to
"what is applied", and the one that is not in the query string is the one that does not survive
a link.

**Why not a stored column:** `active` changes with the passage of time, not with a write. A
column would be correct only as often as the job that refreshes it runs, and every stale row
would read as a live session — the wrong direction to be wrong in for a security surface.

**Why not resolving it client-side:** the answer would depend on the browser's clock, and a
laptop an hour fast would show revoked sessions as live. The row projection already computes
`active` server-side for exactly this reason; the filter has to agree with the column beside it.

**Consequences:** `FieldKind` has eight values and `computed` has exactly one instance. It is
not a plugin seam: `build` takes a value and a clock and returns a Prisma condition, nothing
more, and the test asserts it ANDs with an ordinary field rather than replacing the query. A
second instance is eight more lines in a spec; a third is the signal that the schema is missing
a column. The clock is now part of the compiler's signature, which is what lets the acceptance
ring's fixed clock reach it — a `new Date()` inside a leaf would be a clock no test could move
and no reader would notice. `computed` carries `values` even though `build` does the work,
because the values are what let the console render a two-option select instead of a text box.
