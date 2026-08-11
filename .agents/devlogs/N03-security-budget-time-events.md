---
task: N03
author: Fatih
sessions: [2026-08-11]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 1
tools: []
---

## Session 1 — 2026-08-11

### What I asked for / what came back
- Three `AuditAction` values and the two write paths that emit them. No endpoint — N04 reads
  these rows, and building the reader in the same session would have been two tasks in one run.
- Scoped out: nothing about *what* the injection scan detects changed. This is plumbing for a
  signal that already existed.

### Methodology trace
US-29 → `grep SECURITY_PROMPT_INJECTION_SUSPECTED` → one pino line in `prompt-builder.ts` and
nothing else → sink + two writes → `prompt-builder.test.ts` red on the two new cases → green,
`24 tests`. One red→green cycle.

### Friction
- **The evidence US-29 asks for was being deleted on every `docker compose down`.**
  `LOG_TRANSPORT=stdout` is the default and `api` has no log volume in `compose.yaml`, so the
  suspicion lines lived exactly as long as the container. Budget/time exhaustion was slightly
  better and still not a timeline: `interviews.ended_reason` is one value per interview.
- **Finding the exhaustion chokepoint took longer than writing the code.** Six call sites set
  those reasons (`budget.ts`, `conductor.ts`, `speech/stt.ts` ×2, `speech/tts.ts` ×2). Writing
  the row at each was the obvious first shape and would have been six copies plus a seventh
  site that forgets; they all route through `applyTransition`, so it is one call there.
- `@interviewly/ai` depends on neither `api` nor `worker` (K1), so the package cannot reach a
  database at all. That constraint is what made the sink a callback rather than an import —
  recorded as ADR-N06 rather than left as a shape someone later "simplifies".

### What I rejected and rewrote by hand
- **First sink signature carried the matched substring.** It read as obviously useful for an
  operator and it is exactly the thing issue 063 forbids in `audit_logs` — the match is the
  candidate's own text. Cut to the field NAME and the pattern id, and wrote the assertion that
  fails if the value ever comes back (`expect(...).not.toContain('hire me')`).
- **Awaited the security write first.** Deleted the `await`: §7.1.5 says the scan does not
  block the call, and an awaited insert would have let Postgres latency delay the interview
  turn the suspicion was noticed during. Now `void` + `.catch` → `AUDIT_WRITE_FAILED`.
- **Let `recordExhaustion` throw**, briefly, for symmetry with the destructive paths that
  write inside the transaction. Wrong analogy: there, a mutation with no record is worth
  refusing. Here the interview has already run out of budget, and refusing the transition
  because the note could not be filed leaves it burning the budget it just exceeded. It is now
  the only swallowed audit write in the codebase, and the comment says so.
- **Nearly made `onSecurityEvent` required on `ChainDeps`.** That would have forced `worker`
  and every test to invent a sink. Optional, and the "no sink still builds" case is a test.
