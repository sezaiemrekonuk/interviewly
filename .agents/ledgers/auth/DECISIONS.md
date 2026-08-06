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

---

## ADR-A04 — 2026-07-30 — One `email_tokens` table, hashed, single-use via guarded consume

**Context:** K8.6 reverses the earlier cut of email verification and password reset. Both need a
short-lived, single-use secret delivered by mail. Options: (A) two tables (`verification_tokens`,
`password_reset_tokens`), (B) one table with a `kind` discriminator, (C) signed stateless tokens
(JWT/HMAC) with no table at all.

**Decision:** Option B. `email_tokens(user_id, kind ∈ {verify, reset}, token_hash, expires_at,
consumed_at)`. Store **only** `sha256(token)`. Consume with a guarded update
(`… WHERE id = $id AND consumed_at IS NULL`) and treat `count === 0` as `EMAIL_TOKEN_INVALID`.

**Why not A:** identical columns, identical lifecycle, identical bugs to fix twice.

**Why not C:** a stateless token cannot be revoked or made single-use without a store, and
"single-use" is the property that stops a leaked mail (forwarded thread, shared inbox, browser
history) from being replayable. Adding a store to a stateless design is just design B with extra
signing code.

**Why hashed:** a stored token is a stored credential. A database dump of `token_hash` yields
nothing usable; a dump of plaintext tokens is an account-takeover kit with a 1-hour fuse.

**Why guarded, not read-then-write:** two clicks on the same link (mail clients prefetch; users
double-tap) race. Read-then-write passes a single-threaded test and verifies twice in production.

**Consequences:** one extra table in F02's initial migration and one shared helper
(`modules/auth/tokens.ts`) used by both A04 and A05. Absent and consumed are deliberately
indistinguishable to the caller; expired is its own code because a new link is the fix.

---

## ADR-A05 — 2026-07-30 — Verification is enforced at one gate, behind a config flag shipped `false`

**Context:** Where should an unverified email be refused? Options: (A) at sign-in, (B) on every
authenticated request, (C) on `POST /interviews` only, behind `EMAIL_VERIFICATION_REQUIRED`.

**Decision:** Option C, flag default `false`, seeded accounts pre-verified.

**Why not A:** it makes `SETUP.md` — a scored deliverable (§10, §13) — depend on an evaluator
finding a link in a dev mail sink. Trading a scored item for a feature the brief never asked for is
the wrong direction.

**Why not B:** middleware-wide enforcement multiplies the surface that can lock a user out, and
every endpoint then needs its own "what does an unverified user see" answer.

**Why a flag rather than always-off:** always-off means the enforcement path is never exercised and
rots. The flag is *configuration* — one gate reads it, no `NODE_ENV` branch, so the same image
behaves per config (§11.3) — and `email_verification.feature` runs it both ways.

**Consequences:** `EMAIL_NOT_VERIFIED` exists in the registry and the frontend routes it to
`/verify-email` while preserving the typed listing. The verification mail is always sent and always
prompted regardless of the flag, so turning it on later changes enforcement, not the UX.

---

## ADR-A06 — 2026-07-30 — Reset is enumeration-safe and revokes every session

**Context:** `POST /auth/password-reset/request` reveals account existence in three ways if you are
careless: the status/body, the rate-limit response, and timing. And a reset that leaves old sessions
alive does not evict an attacker.

**Decision:** always `202` with an empty body; rate-limit the endpoint by **IP**, not by user; do
the account-dependent work (mint + enqueue) after responding. Confirm rewrites `password_hash` and
sets `revoked_at` on **all** the user's sessions in one transaction, sets `email_verified_at` if
null, and validates password length *before* consuming the token.

**Why IP-keyed:** a per-user limiter leaks existence through its own `429` — an attacker probes
addresses and watches which ones get limited.

**Why revoke everything:** the button's whole purpose is "someone else may be in my account".
Leaving the attacker's session valid makes the flow theatre.

**Why validate before consuming:** otherwise a mistyped short password burns the link and the user
needs another mail — a self-inflicted support case.

**Consequences:** the caller's own cookie dies on reset; the screen says "you have been signed out
everywhere" and routes to `/sign-in`. A `sessions(user_id)` index is promoted from backlog into A05.
Google-only accounts gain their first password through this flow, which is also the supported way
to satisfy the K8 admin password-only rule.

---

## ADR-A07 — 2026-07-30 — Onboarding is an auth-ledger task, and the profile merge is a snapshot

**Context:** §3.3 adds an account-level onboarding profile (three cards + optional CV) on top of the
existing per-interview pre-questions. Two questions followed: where does the work live, and how does
the account profile reach a generation prompt?

**Decision (placement):** A06 in this ledger. The data is account state on `users`, and the K8.7
routing rule that consumes it fires on sign-in success — this ledger's surface. A dedicated
`onboarding` ledger would have duplicated `REFERENCE.md`, `MODELS.md` and the execution protocol to
own two tasks against a table this ledger already owns.

**Decision (merge):** `interviews.candidate_profile` is a **snapshot** written once by
interview-core: `{ account: <users.profile minus dateOfBirth>, cvText?, perInterview }`. Not a
foreign key, not a join at prompt-build time.

**Why a snapshot:** a profile edited in March must not change what a January report was reasoned
from. Reports are the scored artifact (K15) and must stay attributable to the inputs that produced
them — the same argument that puts `prompt_uuid`/`prompt_version` on the report row (K9).

**Why layer 2 survives layer 1:** the brief's bonus is worded "before moving to the interview
questions the system asks the candidate a few short pre-questions". The per-interview form *is* that
sentence; the account profile is an addition, not a replacement. Deleting the form to avoid
duplication would trade a scored bonus for tidiness.

**Why `date_of_birth` is collected but never sent:** the onboarding card asks for it because the
reference flow does, and it is ordinary account data. Passing an age to an evaluating model invites
age-correlated output we cannot defend, so it is stripped at the backend boundary **and** dropped
defensively in the prompt builder (`PROFILE_DOB_STRIPPED`). The screen says so next to the field.

**Consequences:** `GET /me` grows three routing fields; `POST /uploads` grows a `kind`; the CV joins
the private storage class with a 5-minute signed URL. `onboarding_profile.feature`'s
snapshot-immutability scenario spans two ledgers and is the one place A06 and interview-core must
agree.

---

## ADR-A08 — 2026-07-31 — Google identity resolves from `google_sub` first, and the test seam is the real code path

**Context:** A02 had to turn K8/K8.5 into code. The task file's sketch resolved the Google
identity by email alone, and Cucumber cannot follow a redirect to `accounts.google.com`.

**Decision (resolution order):** `findUnique({ google_sub })` first, then
`findUnique({ email_lower })`. The admin check runs on whichever row matched, before anything
else. An already-linked row short-circuits; only an unlinked row faces the strict
`email_verified === true` gate.

**Why:** email-first would send a Google-only account through the verification gate on *every*
sign-in and lock it out if Google ever omitted the claim. Sub-first weakens nothing — a row can
only acquire a `google_sub` by passing the strict gate once, and Google subs are stable and
unique per account.

**Decision (`email_verified` stays `unknown`):** the Zod userinfo schema types it `z.unknown()`
and the only test on it is `=== true`. No boolean coercion anywhere in the path.

**Why:** coercion is what the K8.5 trap is about. `Boolean("false")` is `true`. Keeping the raw
value means a truthy string, a `1`, or an absent claim all read as unverified by construction
rather than by a rule someone has to remember.

**Decision (test seam):** `POST /test/auth/simulate-google-callback`, mounted only when
`config.NODE_ENV === 'test'`, calling the same exported `resolveGoogleIdentity` and
`issueSessionForUser` the real callback calls. `mountTestSeam()` throws at mount time
elsewhere, so a misconfigured deploy dies at startup instead of serving an auth bypass.

**Why not mock Google in the test:** a mock would prove the mock. The seam skips exactly two
things — the browser redirect and the token exchange — and nothing about the rules, so a bug in
the linking or admin logic fails the acceptance suite.

**Consequences:** `issueSessionForUser` is now the only place a `sessions` row is created;
`register.ts` and `login.ts` were refactored onto it, which is what makes the second K8 check
unbypassable. `OAUTH_STATE_MISMATCH` answers 400 JSON on the callback URL while the admin and
link refusals redirect to `/sign-in?error=<CODE>`, so A03 handles two shapes, not one.

> **Superseded by ADR-A11 (issue 60):** the 400 JSON body is gone. The callback is reached by
> a browser navigation, so that body was painted as the page. Every refusal on both Google
> routes now redirects to `/sign-in?error=<CODE>` — A03 handles one shape after all.

---

## ADR-A09 — 2026-07-31 — Two cucumber profiles, because two rings cannot share one World

**Context:** A01 built the auth acceptance ring on `backend/cucumber.js` with an `AuthWorld`
that boots Express on an ephemeral port and talks to Postgres and Redis. I01 (`1097dc8`) then
introduced a *root* `cucumber.js` for the interview-core rings, whose `AiWorld` is purely
in-memory, and removed backend's `test:acceptance` script. Nothing carried the auth wiring
across, so `auth.feature` and `admin_auth.feature` had not run on master since that commit and
`backend/tests/` was orphaned. A04 needed the ring back before it could add to it.

**Decision:** One root `cucumber.js` with two profiles — `default` (interview-core) and `auth`.
Each names its own `paths` and its own `require` tree. `backend/cucumber.js` was deleted.

**Why not one merged profile:** cucumber allows exactly one `setWorldConstructor` per process,
and both rings define `the response status is {int}` — over different worlds, meaning different
things (interview-core's asserts "generation did not throw"; auth's asserts an HTTP status).
Loading both trees is an ambiguous-step failure before any assertion runs. Merging the worlds
instead would put an HTTP server and a database connection behind every prompt-builder scenario.

**Why not leave the auth ring in `backend/`:** two config files is how it broke the first time.
The next ledger to add a ring appends a profile to one file and cannot silently orphan another.

**Consequences:** `npm run test:acceptance` still runs the `default` profile. The auth ring is
`npx cucumber-js -p auth`, and REFERENCE.md's command list says so. Ordering inside the `auth`
profile matters and is commented at the line: `tests/support/**` must load before
`tests/step-definitions/**`, because `support/setup.ts` fills the env defaults that `env.ts`
validates at import time — with the reverse order `NODE_ENV` defaults to `development` and the
acceptance-only Google seam silently does not mount.

---

## ADR-A10 — 2026-07-31 — The mail queue is injected, not branched on `NODE_ENV`

**Context:** `email_verification.feature` @AC-21 asserts that registration enqueues *exactly one*
`email.send` job. The producer is BullMQ over Redis; the assertion needs to see what was
enqueued.

**Decision:** `modules/auth/mail-queue.ts` exposes an `EmailQueue` interface with a lazily
constructed BullMQ implementation and a `setEmailQueue()` seam. The acceptance harness installs
a recorder in `BeforeAll`; production never calls the setter and gets BullMQ on first use.

**Why not a `NODE_ENV === 'test'` branch:** the environment decides configuration, never
behaviour (§11.3), and a branch would mean the path the scenarios exercise is not the path that
runs in production. The seam keeps one code path and swaps only what it writes to.

**Why not drain a real queue in the scenarios:** it would assert on BullMQ rather than on this
ledger's producer, and add a Redis round-trip to every registration scenario. The consumer side
is covered where it belongs — the booted-stack half of A04's Verification, where a real mail
lands in Mailpit.

**Consequences:** `enqueueEmail` swallows and logs a queue outage (`EMAIL_ENQUEUE_FAILED`), which
is what makes "registration never blocks on the mail" true rather than aspirational. A05 reuses
both the seam and the job.

---

## ADR-A11 — 2026-08-06 — Neither Google route answers JSON, and the button asks before it offers

**Supersedes the `OAUTH_STATE_MISMATCH` half of ADR-A08.**

**Context:** issue 60. `.env` ships `GOOGLE_CLIENT_ID=` empty and the env schema makes it
optional, so a stock clone boots with Google unconfigured — while `GoogleButton` rendered
unconditionally on `/register` and `/sign-in`. The button is a bare `<a>` doing a real browser
navigation (it has to be: only a navigation follows the 302 chain and keeps the `oauth_state`
cookie). So clicking it replaced the entire application with

```
{"error":{"code":"NOT_READY"}}
```

on a blank page, with the Back button as the only way out. That was the one place in the app
where a raw error code reached a visitor; every other refusal goes through `useErrorMessage`.
`ADR-A08` had already established the redirect shape for the two K8 refusals — the JSON body
was reachable precisely on the paths that had not adopted it.

**Decision, two halves.**

1. **No Google route answers with an error envelope.** `refuse(res, code)` in `google.ts` is
   the only way either of them declines, redirecting to `${PUBLIC_ORIGIN}/sign-in?error=<CODE>`
   the way A03 already maps to `errors.<CODE>`. That includes `OAUTH_STATE_MISMATCH`, which
   ADR-A08 deliberately kept as a 400 JSON body — see below.
2. **The button asks first.** `GET /auth/capabilities` answers `{ oauth: { google } }` and
   `GoogleButton` renders `null` until that says yes. It fails closed: a pending or refused
   probe is not a yes, because a dead control is worse than a missing one here.

**Why not the `NEXT_PUBLIC_GOOGLE_ENABLED` build-time flag the issue suggested:** it does not
work in this deployment. `frontend/Dockerfile`'s build stage never sees the env file, and Next
reads `frontend/.env`, not the root one — so the flag would inline as `undefined` and hide the
button on exactly the deployments that *do* have Google configured. Whether a credential exists
is a runtime fact about the server, and only the server can answer it.

**Why revisit ADR-A08's 400:** that decision read the task file's "returned" literally and is
defensible for an API. It is wrong for this URL. `/auth/google/callback` is where the browser's
address bar points during the redirect chain, so its 400 was painted as the document, exactly
like the `NOT_READY` above. The `errors.OAUTH_STATE_MISMATCH` string had shipped in `en.json`
and `tr.json` since F01 and was unreachable — the translation existed for the shape this ADR
finally gives it.

**Why the capabilities endpoint is public and unlimited:** it names no account and touches no
database. It reveals only whether a credential is configured, which a working Google button
announces to anyone who looks at the page.

**Consequences:** the callback checks the state pair *before* it checks configuration, so the
single-use verifier is still burned when a credential has gone missing — a config gap must not
turn that URL into a replayable one. The acceptance ring now forces `GOOGLE_CLIENT_ID` empty
(`cucumber.js`), because it drives Google through the `NODE_ENV=test` seam and a developer's
real credentials would otherwise flip the unconfigured-Google scenario red locally and green in
CI. Both auth screens now mount a query, so their component tests render through
`renderWithProviders` and route the capabilities call separately (`src/test/fetch.ts`).
