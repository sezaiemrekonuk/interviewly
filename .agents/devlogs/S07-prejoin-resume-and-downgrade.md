---
task: S07
author: Ahmet
sessions: [2026-08-09]
model: claude-opus-5[1m]
model_recommended: claude-sonnet-5
iterations: 2
tools: [superpowers:test-driven-development, superpowers:using-superpowers]
---

## Session 1 — 2026-08-09

Tier mismatch, declared: MODELS.md says `claude-sonnet-5`, the session ran `claude-opus-5[1m]`.
EXECUTE.md §5 ends the run on any mismatch; I printed the line and asked, and the owner chose to
override rather than relaunch on Sonnet. Over-tier, not under — no guardrail was lowered.

### What I asked for / what came back
- Asked for the two pre-join gaps and the ADR-S07 copy. Two of the task's five steps were
  already true in the repo: `resumeHref` (step 3) shipped with W08, and `voiceDowngrade` already
  had two call sites from S06 — the task's "zero call sites" was written before S06 landed.
- The task's anchors named `components/home/interview-row.tsx`, which does not exist. The Continue
  link is `SessionCard` in `components/dashboard/modules.tsx`.

### Methodology trace
spec §AC-10 → `.agents/features/speech_fallback.feature:26` → red (2 undefined steps) → green
task step 1 → `pre-join/page.test.tsx:139,152,166` → red (`downgraded()` length 0 → 1) → green
task step 5 → `dashboard/modules.test.tsx` → passed on first run; mutated `resumeHref` to a
constant `'room'` to prove it reddens (2 of 3 failed), then restored. Characterization, not
red→green — recorded as such rather than counted as an iteration.

### Friction
- The existing "denied blocks Enter" test asserted the exact dead end this task removes. Rewrote
  it rather than deleting: the recovery steps still render, only the CTA verdict changed.
- The obvious implementation — invalidate `/state` after the downgrade — is wrong here. `mode`
  flips to `text`, the page's own redirect effect fires, and the candidate never sees the line
  saying why voice stopped. Left the cache alone; the room refetches for itself.
- `npm run -w frontend test -- pre-join home/interview-row` filters on a path that never existed.
  Ran it verbatim anyway (7 passed, pre-join only) and ran the row's tests separately rather than
  editing the command.

### What I rejected and rewrote by hand
- Rejected a `useState` guard on the downgrade: `setMic` re-renders before the POST resolves, so
  the effect fires twice and bills two requests. Replaced with a `useRef` latch, and wrote the
  "downgrades once even as the mic state settles" test to hold it.
- Rejected asserting "no `llm_calls` rows" in the acceptance step — question generation writes
  rows before an interview ever reaches pre-join, so the assertion would have been false for a
  reason unrelated to speech. Scoped it to `provider: 'elevenlabs'`.
- Kept `unavailable.body`'s wording change small but did not skip it: "start a text interview
  instead" described a product that no longer exists once the same interview downgrades.
