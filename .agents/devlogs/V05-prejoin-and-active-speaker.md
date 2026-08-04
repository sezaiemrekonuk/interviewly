# V05 — Pre-join device check + active-speaker signal

**Date:** 2026-08-04
**Branch:** v04-reconciliation-worker-job (V05 work stacked on V04 branch)
**Tier:** claude-sonnet-4.6

## What was done

### Backend
- `backend/modules/voice/session.ts`: added `preJoinDowngrade` handler on `POST /:id/voice/downgrade`.
  Reuses V03's `downgradeToText` — one path from "voice cannot work" to "interview continues in text".
  No `voice_sessions` row is ever written on this path (the non-negotiable from the task file).

### Frontend — new `frontend/src/lib/voice/` modules
- **`device-check.ts`**: `checkDevices()` calls `getUserMedia` for mic (required) and cam (optional).
  Any rejection → `micPermission: 'denied'`. `AnalyserNode` RMS loop exposed as `micLevel$`
  subscription. `release()` stops all tracks and closes `AudioContext`. Safe to call multiple times.
- **`active-speaker.ts`**: `resolveActiveSpeaker(round)` maps `hr_round → 'hr'`, `tech_round → 'tech'`.
  Exactly one tile per round — never two. `createActiveSpeaker(round, source?)` returns a handle with
  `activeTile`, `amplitude$` subscription, and `release()`. Uses `AudioNode`/`MediaStream` when provided;
  falls back to a 120 ms event-timer pulse otherwise (§3.6 fallback, `ponytail:` comment names the ceiling).
- **`session.ts`**: thin `mintVoiceSession(id)` wrapper over `POST /interviews/:id/voice/session`.
- **`downgrade.ts`**: thin `voiceDowngrade(id)` wrapper over the new `POST /interviews/:id/voice/downgrade`.

### Tests
- `frontend/src/lib/voice/device-check.test.ts`: 5 assertions — granted/denied states, any-rejection
  maps to denied, release stops tracks, denied result produces zero mint calls.
- `frontend/src/lib/voice/active-speaker.test.ts`: 4 assertions — hr for hr_round, tech for tech_round,
  never both, deterministic.

### ATDD
- `.agents/features/voice_session.feature`: AC-11 scenario added — a `POST /voice/downgrade` call
  returns 200, sets mode to text, and creates no `voice_sessions` row. The feature file is already in
  `cucumber.js` paths (no change needed there).

### Root tsconfig
- Added `"@/*": ["frontend/src/*"]` path alias so the root `typecheck` command resolves imports in the
  new voice modules.

## Verification results

| Check | Result |
|-------|--------|
| `npm run -w frontend test -- voice/device-check voice/active-speaker` | 9/9 passed |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm test` | 2 pre-existing EPERM (admin/csrf sandbox socket failures); no new failures |
| Cucumber `--tags "@voice-session"` | skipped — Docker not available in sandbox |

## Open questions resolved / not resolved

- **ElevenLabs audio surface (§15.1 item 3)**: not resolved. `active-speaker.ts` is structured to accept
  an `AudioNode | MediaStream` parameter; the event-timer fallback runs until the SDK spike confirms
  whether the SDK exposes one. `AmplitudeAvatarDriver` existence remains open.
- **Step 3 (text-mode guard)**: `checkDevices()` returns `micPermission`; the pre-join page (W09/frontend)
  reads it and does the redirect. No routing code in this task — `frontend` owns the page composition.
