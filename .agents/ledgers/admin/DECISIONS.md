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
