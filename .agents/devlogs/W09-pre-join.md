---
task: W09
author: Sezai
sessions: [2026-08-05]
model: claude-sonnet-4.6
model_recommended: claude-sonnet-4.6
iterations: 2
tools: [superpowers:test-driven-development, ponytail, caveman]
---

## Session 1 — 2026-08-05

### What I asked for / what came back
- Asked for the whole screen at once (hook + component + page + copy + tests). Came back as a
  *sketch*: three files with `TODO` comments, placeholder strings instead of `useTranslations`
  calls, no CSS modules, no tests. Usable as a skeleton, not as the task.
- Second pass, one file at a time against DESIGN §5's table — that produced the shipped code.

### Methodology trace
DESIGN §5 W09 table → `use-mic-permission.test.ts` (5 cases) + `page.test.tsx` (4 cases) →
red → hook + `MicCheck` + page → green (9/9).
Red check on the load-bearing one: removed `release()` from the unmount cleanup → 2 tests fail
(`releases the track on unmount`, `leaving the screen stops the media track`) → restored.

### Friction
- **Duplicate export on master.** `lib/query.ts` declares `useDeleteInterview` twice (`483797b`).
  Rolldown refuses the module, so `page.test.tsx` never even parsed — the failure looked like my
  test file. Deleted the second copy; both were behaviourally identical.
- `enumerateDevices` before a grant returns empty labels, so the device `<select>` was blank on the
  first render. Moved enumeration to after `getUserMedia` resolves.
- jsdom has no `AudioContext`. Rather than mock one in every test, the hook skips the meter when the
  constructor is absent — level stays 0 and the status line stays honest.
- `npm run lint` and `npm test` are red at repo level for reasons outside this task: worker
  `consumer.ts:30` `no-explicit-any`, and `pdfkit` declared in `worker/package.json` but not present
  in the local `node_modules` (2 worker suites fail to import). Frontend alone: 28 files / 220 pass.

### What I rejected and rewrote by hand
- The sketch's `onStateChange: (granted: boolean)` — a boolean cannot express `unavailable`, which
  DESIGN §5 renders differently (CTA removed, no retry). Changed to pass `MicPermissionState`.
- The sketch's single `denied || unavailable` branch and its `preJoin.recovery.*` keys — split into
  two blocks with their own copy.
- The sketch's inline `style={{ transition: 'none' }}` and `data-level` — replaced with a CSS module
  so the token lint can see the values, and a real `width: N%` fill.
- A `catch { setState('denied') }` that swallowed "no microphone on this machine" into a retry
  prompt that could never succeed. Now keyed on `err.name`.
