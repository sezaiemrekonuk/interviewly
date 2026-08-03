# W01 — UI build/seed checks: token lint, AA-contrast, avatar/mascot set validation, gradient/shadow tiers
REPO: (this repo) · Depends: F01, F02 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — a deterministic Vitest suite over fixed token values and the seeded
asset contract. No runtime state, no trust boundary; the reasoning is arithmetic (contrast ratios)
and set-membership.

## Goal
Owner's ask (the `ui` spec's 17 build/seed ACs, folded here per ADR-W03):

> "F01 shipped the tokens and the type unions; F02's seed uploads the avatar and mascot objects.
> No task owns the verification `COVERAGE.md` demands: token lint, computed AA-contrast including
> each gradient stop, avatar-set and mascot-set validation against the size budgets, the gradient
> route-list check, the shadow-tier check. Fold these into the frontend ledger's first task. Do
> not create a separate `ui` ledger."
> — PLAN_FRONTEND_LEDGER.md §2, ui spec Acceptance criteria 1–12, COVERAGE.md §`ui`

This task is a Vitest suite (no product screens) that fails before the checks exist and covers the
six check families. It guards the token/asset foundation every later screen composes on.

## Non-negotiables
- **Token lint (ui AC-1).** Every `--` token in ui §4.2 exists exactly once in
  `frontend/styles/tokens.css` with its shipped value. No colour hex, no px radius/shadow, no font
  family, no off-scale type size (allowed: `13/14/16/20/28/40/56`), no non-multiple-of-4 spacing
  appears as a literal in `frontend/src/**` or `frontend/styles/globals.css` outside the registry.
  (F01 **darkened** `--text-muted`/`--primary`/`--live` for the AA floor — assert the *shipped*
  values in `tokens.css`, not the ui-spec literals `#6B6F8D`/`#FF6100`/`#16A34A`.)
- **AA contrast (ui AC-2).** Each pinned normal-text pair computes to ≥ 4.5:1 by a WCAG-2.1
  relative-luminance calc: `--text` and `--text-muted` over `--bg`/`--surface`/`--surface-sunken`,
  `--text`/`--text-muted` over **each of** `--grad-lavender`/`--grad-cream`/`--grad-peach`
  individually, white on `--primary`, white on `--live`. An average over the gradient is not a
  floor — assert each stop.
- **Gradient route-list (ui AC-4a).** The closed entry-route set — landing, register, sign-in,
  verify-email(+pending), forgot-password, reset-password, onboarding (one family), setup, pre-join
  — is asserted from a single shared constant; room, report, dashboard, admin are **not** in it.
- **Shadow tier (ui AC-4b).** `--shadow-soft` is permitted only on entry surfaces; the room is
  limited to `--shadow-hairline`. Assert the rule as data (a surface→max-shadow map) so a later
  screen's misuse is a review-catchable violation.
- **Avatar-set completeness + key shape (ui AC-6, AC-7, AC-10).** The `AvatarState` union has
  exactly the five members `idle|listening|thinking|speaking|acknowledging`; `MascotPose` has
  exactly `wave|point|think|cheer|shrug`. A content-addressed key matches
  `personas/{personaId}/{state}-{sha256}.webp` / `mascot/{pose}-{sha256}.webp`, and the seed
  (`backend/prisma/seed.ts`, `AVATAR_STATES`/`MASCOT_POSES`) covers every union member — a missing
  member is `AVATAR_STATE_INCOMPLETE` / `MASCOT_POSE_INCOMPLETE` naming the gap.
- **Size budgets (ui AC-7/§3.6, §4.2.1).** Assert the budget ceilings hold for the seeded objects:
  ≤ ~60 KB/avatar image, ~350 KB/persona set; ≤ ~40 KB/mascot image, ~200 KB/set. The F02
  placeholders are 34-byte WebPs, so this passes trivially today; the assertion is the ceiling a
  real-artwork swap must still clear.

## Context (anchors)
- `frontend/src/ui-checks/tokens.test.ts` — **create.** Parse `frontend/styles/tokens.css`;
  assert presence/uniqueness/value of every §4.2 token; scan `frontend/src/**` +
  `styles/globals.css` for stray literals (hex, off-scale type px, non-4 spacing, raw shadow/font).
- `frontend/src/ui-checks/contrast.test.ts` — **create.** A small WCAG relative-luminance helper
  (write it here, ~15 lines — no dependency) + the pinned-pair table; assert each ≥ 4.5.
- `frontend/src/ui-checks/grounds.test.ts` — **create.** Import the shared entry-route constant
  and the surface→shadow map; assert the gradient/shadow closed lists.
- `frontend/src/lib/entry-routes.ts` — **create.** `ENTRY_ROUTES` (the closed gradient route list)
  and `SURFACE_SHADOW` (surface→`'soft'|'hairline'`). W02's shell and every screen import these so
  the ground/shadow decision is data, not a per-screen judgement (ui §4.1 "closed list, not a
  judgement call").
- `frontend/src/ui-checks/assets.test.ts` — **create.** Import `AvatarState`/`MascotPose` from
  `@interviewly/types` (F01) — assert exact membership. Import `AVATAR_STATES`/`MASCOT_POSES` and
  the key template from `backend/prisma/seed.ts` if cross-workspace import resolves; if it does not,
  re-declare the expected sets here and assert the union members match them (a seed divergence then
  shows as a union mismatch). Assert the key regex and the byte-budget ceilings.
- `frontend/styles/tokens.css` (:F01) — the registry under test. Do not edit it; W01 only reads it.
- `backend/prisma/seed.ts` (:F02) — `AVATAR_STATES` (line 104), `MASCOT_POSES` (line 112), the
  content-addressed key template (lines 151, 182), the immutable cache header (line 76).

  **The trap:** the AA check must use the **shipped** `tokens.css` values, which F01 already
  darkened to pass the floor. If you compute contrast against the ui-spec literals you will either
  pass for the wrong reason or fail a token F01 deliberately corrected — read the value out of the
  CSS, do not hard-code the spec hex.

## Steps
- [ ] **1. `entry-routes.ts`** — `ENTRY_ROUTES` closed list + `SURFACE_SHADOW` map, the single home
  for the ground/shadow decision.
- [ ] **2. `tokens.test.ts`** — token presence/uniqueness/value + the stray-literal scan.
- [ ] **3. `contrast.test.ts`** — the WCAG luminance helper + every pinned pair incl. the three
  gradient stops, each ≥ 4.5.
- [ ] **4. `grounds.test.ts`** — assert the gradient route-list and the shadow-tier map are the
  closed sets the spec pins.
- [ ] **5. `assets.test.ts`** — `AvatarState`/`MascotPose` exact membership, the content-addressed
  key regex, the seed's set coverage, and the byte-budget ceilings.
- [ ] **6. Run the `## Verification` command** and see every check pass (and confirm a deliberately
  wrong token value makes `tokens.test.ts` red — do not commit that, just prove the check bites).

## Definition of done
- `npm run -w frontend test -- src/ui-checks` passes with all six check families present.
- A token value edited to break the AA floor makes `contrast.test.ts` red (checked once, reverted).
- Removing a member from the `AvatarState`/`MascotPose` expectation makes `assets.test.ts` red
  naming the missing state/pose.
- No product screen or component is added — this task is verification only.

## Verification
```bash
npm run -w frontend test -- src/ui-checks
```
Expected: the `src/ui-checks/*.test.ts` suites pass; the run reports the token, contrast, grounds
and asset check families as passing, and zero stray-literal violations in `src/**`.

## Notes

(Empty until the task is done.)
