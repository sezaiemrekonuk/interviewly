---
task: T02
author: Ahmet
sessions: [2026-08-11]
model: claude-opus-5
model_recommended: claude-opus-5
iterations: 1
tools: [EXECUTE.md]
---

## Session 1 — 2026-08-11

### What I asked for / what came back
- "start t02". §4 agreed: `T02` was the only unblocked row of mine (F03, S03 both `done`).
- Two new files, no edits to existing code. `pending-turn.ts` + 17 unit tests.

### Methodology trace
`T02 Step 1` → `pending-turn.test.ts` → red (module not found) → implement → 17 green.
Split-MULTI check (task `## Verification`) → `get`+`del` → red on `is consumed exactly once`
only → restored → green.

### Friction
- **The concurrency test is only worth anything if the fake interleaves.** A `Map`-backed fake
  whose commands resolve synchronously passes with `get`+`del` too, which would have made the
  whole task's stated risk untestable. Fixed by resolving every command on its own macrotask and
  applying a `multi()`'s queued commands in one step after a single await. That is the difference
  the transaction actually buys, and now the test can see it.
- **`docker compose up -d cache` in the Verification is a no-op for this test.** `.env` has
  `REDIS_URL=redis://cache:6379`, which does not resolve from the host, so a unit test could not
  have used the real server anyway. Ran it verbatim regardless — the command is the command.
- Repo has no Prettier (ESLint only, `lint-staged` confirms). `npx prettier --check` warns on both
  new files against its own defaults; ignored, and the real pre-commit config passes clean.

### What I rejected and rewrote by hand
- **Enforcing the caps inside `holdPendingTurn`.** Tempting — the constants are right there — and
  wrong: Step 2 exports them for T03, and a module that silently truncates at 6 000 chars would
  hide the force-submit T03 is supposed to trigger. Left as constants, said so in `## Notes`.
- **A separate `catch` for a malformed `exec()` result.** Folded into the connection-error branch:
  same outcome (`null`), one log event instead of two names for one thing.
- **`logger.debug` on one line** in `takePendingTurn` — over the line budget, wrapped by hand.
