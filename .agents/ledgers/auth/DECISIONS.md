# Auth — Decisions (append-only ADR log)

Never edit past entries. Supersede with a new dated entry referencing the one it changes.
Prefix `ADR-A` to avoid collision with foundations (`ADR-F`) and other ledgers.
Referenced back into `PLAN.md`.

---

## ADR-A01 — 2026-07-30 — DB-backed opaque session token over JWT refresh families

**Context:** K8 required a choice between (A) DB-backed opaque token with sliding expiry,
(B) short-lived JWT + long-lived refresh token with reuse detection (the "refresh-token
family" approach), or (C) persistent JWT with no refresh. The brief mandates a
`sessions` table with `revoked_at` (K8).

**Decision:** DB-backed opaque token. The server generates a random ID, inserts a `sessions`
row (`user_id`, `expires_at`, `revoked_at`), and sets it as an `httpOnly`, `Secure`,
`SameSite=Lax` cookie. Every authenticated request reads the row to check expiry and
revocation. Expiry slides on each successful check: `expires_at` is pushed forward 7 days
from `now()`.

**Why not refresh families:** IDEA.md K8 cuts them explicitly — "OAuth-provider machinery
for a demo with three real users. It scores the same 6 points and costs a day of edge
cases." The reuse-detection complexity (token rotation, grace windows, revocation
cascades) is not proportionate to the project scale. Server-side revocation is a single
`UPDATE sessions SET revoked_at = now()` — simpler and equally effective.

**Why not persistent JWT:** No server-side revocation path. Admin blocking or account
suspension would require a denylist, which costs the same as the sessions table and adds
complexity without the relational lookup already in the data model.

**Consequences:** Every authenticated request incurs one DB read (sessions row by PK).
That read is indexed (PK lookup) and acceptable at this scale. The session token is
opaque — if it leaks, rotation is `UPDATE sessions SET revoked_at = now()` and a new
sign-in. K8 lists this as the explicit design.

---

## ADR-A02 — 2026-07-30 — `arctic` for Google OAuth PKCE over Passport.js

**Context:** The Google OAuth flow requires Authorization Code + PKCE (K8). Options:
(A) `arctic` — a minimal OAuth 2.0 client for JavaScript that provides PKCE utilities and
token exchange without strategy abstraction, (B) `passport-google-oauth20` — mature
strategy plugin for passport.js, (C) hand-rolling the PKCE flow with `node:crypto`
and `fetch`.

**Decision:** `arctic`. IDEA.md K8 names it explicitly.

**Why not passport.js:** Passport introduces a parallel user serialisation model
(`serializeUser`, `deserializeUser`, `done()`) that sits alongside the auth module's own
session logic. The spec requires asserting on PKCE state/verifier mismatches, `email_verified`
checks, and admin restriction at the callback level — these assertions are clearer when
the code owns each step explicitly rather than routing through a strategy callback. The
`OAUTH_STATE_MISMATCH` and `ACCOUNT_LINK_REQUIRES_PASSWORD` error paths need to surface
as typed responses, not passport failure redirects.

**Why not hand-rolling:** `arctic` provides correct PKCE code-verifier/code-challenge
generation and token endpoint handling, tested against Google's OAuth server. Reimplementing
these correctly is riskier than using a maintained library IDEA.md already chose.

**Consequences:** `arctic` is a relatively new library (though actively maintained at
IDEA.md authoring time). The session cookie and user resolution logic remain entirely in
`modules/auth/` — no framework owns the user model. PKCE state and verifier are stored
in short-lived `httpOnly` cookies (same attributes as the session cookie) and consumed
once in the callback.

---

## ADR-A03 — 2026-07-30 — `@node-rs/argon2` for password hashing over `argon2`

**Context:** argon2id is the required algorithm (K8). Two packages implement it in Node.js:
(A) `@node-rs/argon2` — pre-built native binaries for common targets including `linux-musl`
(Alpine), (B) `argon2` — a Node.js native module that requires `python3`, `make`, and
`g++` at build time.

**Decision:** `@node-rs/argon2`. IDEA.md K8 names it explicitly, citing the Alpine
build-dependency problem.

**Why not `argon2`:** Requires `python3 make g++` on Alpine, which contradicts the
same reasoning that chose `unpdf` in K12 — the project avoids build-time native
toolchains on Alpine images to keep Dockerfiles lean and CI fast. Installing those tools
adds ~200 MB to the image and a slow `npm install` in every CI run.

**Consequences:** `@node-rs/argon2` exposes a slightly different API surface than the
`argon2` package (`hash`, `verify` instead of `argon2.hash`, `argon2.verify`). Tasks must
use the `@node-rs/argon2` API. Algorithm parameters default to argon2id with secure
defaults; no custom parameter tuning is in scope.
