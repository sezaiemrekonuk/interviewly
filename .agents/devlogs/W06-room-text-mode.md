---
task: W06
author: Sezai
sessions: [2026-08-04]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 4
tools: [cavecrew-investigator, ponytail, caveman]
---

## Session 1 — 2026-08-04

### What I asked for / what came back
- Asked for the text room per the task file. A prior sonnet pass had left seven sketch files with
  `TODO(opus)` markers and a hand-off note: "room-state has no persona-id or round-list field, so
  inactive tile + transcript entries have no data source yet".
- Verified the claim against `backend/modules/interview/state.ts` instead of trusting it. It held:
  `persona` is `{ role, name, avatarState }`, no roster, and `transcriptCursor` is a
  `chatMessage.count` with no rows behind it.
- Decided (C) of three options — extend the I03 handler additively — and recorded ADR-W06.
  (A) client-side derivation would have rendered `seed-persona-hr` and a guessed sha: identities
  the server never named, in the one screen K11 exists to protect.

### Methodology trace
spec §3.8 → `room-avatar.test.ts` → red against the sketch (`resolveAvatarState('settled','listening')`
returned `idle`; `roomPhase` did not exist) → green.
K11 → `page.test.tsx` "never from the event body" → emits an SSE payload naming a persona the state
endpoint never returns, asserts the tile flips to the *refetched* one and `Ghost` never renders.
Tests all passed on the first full run, so I mutated the implementation to check they bite:
`live = true` and disabling the silent refetch → 3 failures, the three invariant tests.

### Friction
- Two `ui-checks` gates failed after the first green: raw `box-shadow` for the `--live` ring, and a
  `2px` badge padding. Room shadow is capped at `--shadow-hairline` and spacing must be a multiple
  of 4 — the ring became an `outline`. Good gates; found by `npm test`, not by review.
- The pre-commit hook rejected the commit after `npm run lint` passed: husky lints staged
  `frontend/**` with `frontend/eslint.config.mjs`, which carries `react-hooks/refs` and
  `react-hooks/set-state-in-effect`. Both hit `question-panel.tsx` (a ref written during render,
  and the reduced-motion `setShown` inside the effect). Fixed by keying the panel on the question
  id — one instance per question, so the reduced case is initial state and the ref is unnecessary.
- `npm run test:acceptance` never starts on the host: `.env`'s `REDIS_URL` is the compose-internal
  `cache` (`ENOTFOUND`), so it sits in ioredis retries with buffered output looking like a hang.
  Running it inside the `api` container would truncate the dev DB, so I did not. Not claimed as
  passing; flagged in the task Notes.

### What I rejected and rewrote by hand
- The sketch's `PHASE_TO_STATE[phase] ?? serverAvatarState` — `settled` mapped to `idle` in the
  table, so the `??` fallback was unreachable and the server's sync value could never render.
  Rewrote as an explicit `settled`-only fallback, with an allow-list so an unknown server string
  is not turned into an image key.
- The sketch's `onTypingDone?: () => void` — a bare "done" callback lets a fresh question inherit
  the previous one's finished flag and skip its animation. Now `onTyped(questionId)`, and the page
  compares ids.
- The sketch's `shaByState` prop, which asked the client where the sha comes from. Deleted: the
  persona row already stores `avatar_set`, so the keys ship with the payload.
- The sketch's composer-owned mutation and its per-code branching. The page owns the mutation (one
  `isPending` for the avatar beat) and `SILENT_REFETCH_CODES` moved into `error-routing.ts` so the
  §4.5 table has one home instead of a copy in `query.ts`.
