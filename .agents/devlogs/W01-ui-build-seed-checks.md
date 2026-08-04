---
task: W01
author: Sezai
sessions: [2026-08-04, 2026-08-04]
model: claude-sonnet-4.6
model_recommended: claude-sonnet-4.6
iterations: 3
tools: []
---

## Session 1 — 2026-08-04

### What I asked for / what came back

EXECUTE.md § 3/§ 4 picked W01 — first `todo` row of mine (foundations/interview-core all
`done`), deps `F01`/`F02` both `done`. Tier matched (sonnet). Built the six check families in
one pass: `entry-routes.ts` (the new shared `ENTRY_ROUTES`/`SURFACE_SHADOW` data W02 will
import), then `tokens.test.ts`, `contrast.test.ts`, `grounds.test.ts`, `assets.test.ts`.

### Methodology trace

ui AC-1/2/4a/4b/6/7/10 → four Vitest files → red once each (deliberately, per Definition of
done), then green. `npm run -w frontend test -- src/ui-checks` → 55 passing.

### Friction

- First `box-shadow` stray-literal regex used a `(?!var\()` lookahead placed after a greedy
  `\s*`; the engine backtracked the whitespace match to satisfy the lookahead and matched
  `var(--shadow-soft)` as if it were raw, false-failing on `auth.module.css`. Rewrote as
  capture-then-check-prefix in JS instead of a regex negative lookahead — simpler and
  correct.
- `@interviewly/types` has `main: dist/...` but nothing builds `packages/types` yet
  (`node_modules/@interviewly/types` is a workspace symlink to source, no `dist/`), so the
  cross-workspace import the task suggested does not resolve under this frontend Vitest
  config. Used the task's documented fallback: re-declared `AvatarState`/`MascotPose`
  locally and diffed against the seed's arrays by regex-parsing `seed.ts`. Noted in the task
  `## Notes` for whichever task builds the types package first.

### What I rejected and rewrote by hand

Nothing generated was thrown away — this was a from-scratch Vitest suite over fixed data, no
scaffold to reject.

## Session 2 — 2026-08-04 (audit + repair of `assets.test.ts`)

### What I asked for / what came back

Re-read session 1's four files before moving on. `tokens.test.ts` and `contrast.test.ts`
parse the real `tokens.css` and bite. `assets.test.ts` did not: it re-declared
`AvatarState`/`MascotPose` as local literals and asserted them against a second local
literal, checked the seed one-directionally (missing only), built its key-shape fixture out
of its own regex alternation, and compared a hardcoded `34` to the byte ceilings.

### Methodology trace

Mutation-tested the claim instead of arguing it: added a 6th pose `salute` to the seed's
`MASCOT_POSES` → **8 passed**, a false green of exactly the kind EXECUTE.md § 7 warns about.
Rewrote every expectation to read a real source — `packages/types/src/index.ts` (union),
`schema.prisma` (enum), `seed.ts` (arrays, key templates, base64 `PLACEHOLDER_WEBP`) — and
required all three to agree exactly. Re-ran the same mutation → red, naming `salute`;
dropping `acknowledging` from the union → 3 red. 55 → 58 tests.

### Friction

The three sources of truth were all sitting there (the Prisma enums, the types package
source, the seed) and session 1 used none of them — it copied the members into the test.
The `dist/` import problem was real, but reading the package *source* was the fix; the
task's "re-declare locally" fallback was the wrong branch to take.

### What I rejected and rewrote by hand

Rejected session 1's `assets.test.ts` almost whole — 4 of its 8 tests could not fail on any
real change. Kept the budget constants and the two key regexes; everything else re-derived.
