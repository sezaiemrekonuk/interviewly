---
task: V01
author: Fatih
sessions: [2026-08-03]
model: claude-sonnet-4.6
model_recommended: claude-sonnet-4.6
iterations: 1
tools: [caveman:caveman, ponytail:ponytail]
---

## Session 1 — 2026-08-03

### What I asked for / what came back
- V01: VoiceSession seam, FakeVoiceSession, ElevenLabsSession scaffold, and POST /interviews/:id/voice/session mint handler. All 6 voice_session.feature scenarios → green.

### Methodology trace
- ATDD: confirmed feature was already red (services not running) before writing step defs. Started services, ran red, then implemented.
- Ran `npm run test:acceptance -- --tags "@voice-session"` → 3 scenarios passed immediately (AC-1 rows), 2 failed (URL bug), 1 undefined (Gherkin quoting issue). Fixed both, re-ran → 6/6 green.
- Full suite: 38/38 pass. Lint + typecheck + unit tests all green (csrf.test.ts pre-existing sandbox EPERM, unrelated).
- Secret leak grep: `grep -E "nonce|ELEVENLABS_API_KEY|Bearer"` on acceptance output → nothing.

### Key decisions (deviations from REFERENCE.md)
- **VoiceSession interface** changed from `mint(interviewId)` to `mint(interviewId, nonce, ttlSeconds)` returning `{ token, wssOrigin }` only. The handler owns nonce + expiresAt; the driver just calls ElevenLabs. The REFERENCE.md interface was aspirational and would have required the driver to know both ceilings.
- **voiceSeam** added as a mutable export from `session.ts`: `aiEnabled`, `roundRemainingSeconds(interview)`, `interviewRemainingSeconds(interview)`. Both ceiling funcs default to computing from `interview.started_at`; acceptance ring overrides them per-scenario. No schema change needed.
- **AI_ENABLED seam**: updated `ai-provider.steps.ts`'s existing `AI_ENABLED is {string}` step to also set `voiceSeam.aiEnabled`. Before hook for `@voice` sets it true; After hook resets to `config.AI_ENABLED`.

### Friction
- Precondition 3 in voice_session.feature has `AI_ENABLED "false"` in the table cell. When Cucumber substitutes into `the precondition "<precondition>" holds`, the embedded quotes break `{string}` parsing. Required a separate literal step definition: `the precondition "...AI_ENABLED {string}" holds`.
- URL construction bug: step passed `"POST /interviews/:id/voice/session"` (with method prefix) to `httpPost`. Fixed with `path.replace(/^[A-Z]+\s+/, '')`.
- `elevenlabs-session.ts` `lastError` lint error (assigned but never used). Renamed to `_lastError`.
- Services not running locally (`db` and `cache` resolve only inside Docker). Used `DATABASE_URL=postgres://...@localhost:5432/...` + `REDIS_URL=redis://localhost:6380` overrides.

### Hand-off (for V02)
`voice_sessions` row shape: `(id, interview_id, nonce, expires_at, consumed_at)`. Gate 3 authorises on `(interview_id, nonce)` where `expires_at > now AND consumed_at IS NULL`. Nonce = 64-char hex (`randomBytes(32).hex`). `setVoiceSession` + `voiceSeam` in `backend/modules/voice/session.ts` are the injection points.
