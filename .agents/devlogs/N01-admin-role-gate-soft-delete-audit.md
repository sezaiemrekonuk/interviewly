---
task: N01
author: Fatih
sessions: [2026-08-03]
model: claude-opus-5
model_recommended: claude-opus-4.8
iterations: 1
tools: []
---

## Session 1 — 2026-08-03

Tier matches (MODELS.md asks opus-tier, ran opus-tier); the exact ids differ only because the
ledger was written before Opus 5. Not aligned quietly, per EXECUTE.md § Devlog.
`superpowers:brainstorm` — which the invocation nominates for problems — is not installed in
this session, so the two design calls below were reasoned out and written down instead.

### What I asked for / what came back
- Scoped strictly to N01. `GET /admin/stats` left to N02 even though the same router and the
  same bypass would have made it ~20 lines.
- Backend only: no frontend admin panel, no faceted filters (already in STATE backlog).

### Methodology trace
`admin_cost.feature` @AC-17 → wired into `cucumber.js` → red (404 with **no body** — Express's
unmatched-route default, not the ownership resolver) → `requireAdmin` + 4 handlers + mounts →
green, `1 scenario / 13 steps`. One red→green cycle.

### Friction
- **The Verification command was a false green waiting to happen.** `admin_cost.feature` was in
  neither cucumber profile's `paths`, so `--tags "@admin-cost and @AC-17"` matched 0 scenarios
  and exited 0 — exactly what EXECUTE.md §7 warns about. Found it by reading `cucumber.js`
  before trusting the command, not after it "passed".
- **The task file's step-definition path was stale.** It says `tests/step-definitions/admin.ts`
  (auth ring). But `npm run test:acceptance` is the `default` profile only, so steps there
  would never have run under the command as written. Put them in the default ring — which has
  booted the real app over HTTP since I03 — so the command is honest. REFERENCE.md patched.
- **~20 min lost to the local environment**, none of it to the task: root `.env` uses the
  docker-internal hostnames `db`/`cache`, so the suite cannot run from the host at all
  (`getaddrinfo ENOTFOUND cache`, a BeforeAll timeout that reads like a hang). And
  `interviewly_test` did not exist — `db/init.sql` creates it, but only on a fresh volume.
  Both now written into REFERENCE.md so the next session pays it once.
- Ran the full baseline suite *before* touching anything (39 green). Worth it: it made the
  40th scenario unambiguous rather than something to argue about.

### What I rejected and rewrote by hand
- **First pass at `requireAdmin` was `if (!req.user) 401 / if (role !== 'admin') 403`.** Deleted
  the 401 branch. `requireAuth` already owns unauthenticated, and a second opinion on it in the
  gate is a divergence waiting to happen. Now one condition, one outcome.
- **A `deleted?: boolean` flag on `userInterviews()`** — briefly attractive, one query for both
  lists. That is precisely the shared-conditional leak ADR-N02 rejects: one wrong default and
  deleted rows are back in a candidate's list. Two call paths instead.
- **Generated per-row `llm_calls` sums** (N+1 across the page). Rewrote as one
  `groupBy(['interview_id'], _sum)` over the page's ids. Also had to coalesce — `input_tokens`
  and `output_tokens` are nullable `Int?`, which the first version ignored and would have
  returned `null` totals for any stubbed call.
- **My own comments broke the Verification greps.** `grep "prisma.interview.delete\b"` "must
  print nothing" and my comment in `delete.ts` said exactly that phrase while explaining why it
  never calls it. Reworded rather than weakening the grep.
- **Shipped two unit tests the ACs cannot reach**, because the DoD claims `requireAdmin`
  "returns 403 correctly now" while @AC-17 only ever signs in the *admin* — the deny path had
  zero coverage and @AC-18 is N02's. Covers no-user, `administrator`, `notadmin`, and a route
  mounted after the gate.
- **Added a cuid shape-check to `decodeCursor`** after noticing a hand-made `?cursor=` decodes
  to arbitrary bytes and reaches Prisma's `cursor` — a 500 off a query string. Not in any AC;
  it is my endpoint, so it is my bug.
- **Did not** delete `and not @AC-29` from the `auth` profile, though N01 shipping
  `GET /me/interviews` is the trigger its comment names. Those scenarios and steps are the auth
  ledger's. Flagged for Ahmet in STATE.md instead of reaching into someone else's seat.
