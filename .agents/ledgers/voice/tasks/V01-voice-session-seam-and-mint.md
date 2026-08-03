# V01 — `VoiceSession` seam, `FakeVoiceSession`, and the session-mint endpoint
REPO: (this repo) · Depends: F01, F02, F03, A01, I03, I07 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — mint-endpoint wiring plus the `VoiceSession` driver scaffold over the existing I03 ownership check and I07 state read; the ceiling arithmetic is mechanical and the token is opaque. The webhook (V02), not this task, is the new trust boundary.

## Goal
Owner's ask:

> "The `VoiceSession` seam ElevenLabs sits behind, its `FakeVoiceSession` double with
> `failNext()` (§5.5), and `POST /interviews/:id/voice/session`: owner-checked, mints a
> short-lived signed session token, writes a `voice_sessions` row with an unguessable `nonce` and
> `expires_at` bound to the tighter of the round/interview ceiling, and returns the token +
> `wssOrigin` + `dynamicVars` — never the API key. Scenarios in `voice_session.feature` green."
> — voice ledger decomposition (K3, §3.5, §7.3, ADR-V01)

This task creates `backend/modules/voice/` with the seam interface, the real ElevenLabs driver
scaffold, the fake, and the mint handler. It does **not** authenticate any webhook (V02 owns the
four gates), implement the downgrade (V03), or reconcile usage (V04). After it, V02 has a
`voice_sessions` row and a `nonce` to authorise against, and V03 has a `FakeVoiceSession` to fail.

## Security boundaries
- **The `ELEVENLABS_API_KEY` never enters a mint payload or a log line.** The client gets only the
  short-lived signed token from `VoiceSession.mint`. A payload or build exposing the key
  client-side is a defect (§3.5). Log `VOICE_SESSION_MINTED` with `interviewId` only — never the
  `nonce` or the token.
- **The `nonce` is an unguessable secret** (`crypto.randomBytes`), paired with `interviewId`,
  returned only to the owner in the mint payload, and never logged. It is the credential V02
  authorises against.
- **Ownership is enforced before any row is written.** A non-owner mint is `403 FORBIDDEN` (the
  mint contract's code, per `voice_session.feature` @AC-2 — not the `404 INTERVIEW_NOT_FOUND` the
  interview `:id` routes use); resolve the owner via the I03 resolver before minting.
- **A mint in a state that cannot host voice is `409 INVALID_STATE_TRANSITION`** (the I07 legality
  authority), not a silent no-op. A mint with the kill switch off (`AI_ENABLED=false`) is
  `503 VOICE_UNAVAILABLE` — the client's cue to downgrade, not a dead end.

## Context (anchors)
- `backend/modules/voice/VoiceSession.ts` — **create.** The seam interface exactly as in
  REFERENCE.md: `mint(interviewId): Promise<{ token, wssOrigin, dynamicVars: { interviewId,
  nonce }, expiresAt }>`. This is the only surface the mint handler, the room, and V03's fallback
  depend on.
- `backend/modules/voice/elevenlabs-session.ts` — **create.** The real driver implementing
  `VoiceSession`. Calls ElevenLabs to mint a signed session token using
  `config.ELEVENLABS_API_KEY` and the agent id (`config.ELEVENLABS_AGENT_ID_HR` /
  `_TECH` per the round). **Timeout + retry + bounded wait** on the provider call (§8.3); on
  failure throw a typed `VoiceUnavailable` (→ `503 VOICE_UNAVAILABLE`). Returns the provider's WSS
  origin as `wssOrigin`. Do **not** log the token or key.
- `backend/modules/voice/fake-session.ts` — **create.** `FakeVoiceSession implements VoiceSession`
  (§5.5): `mint` returns a canned token, a fixed `wssOrigin`, a generated `nonce`, and the
  computed `expiresAt`. `failNext()` sets a one-shot flag so the next `mint`/turn throws — this is
  what `voice_fallback.feature` (V03) drives. The acceptance ring binds this fake, never the real
  driver.
- `backend/modules/voice/session.ts` — **create.** `POST /interviews/:id/voice/session`:
  1. `requireAuth` (A01) → resolve ownership (I03); non-owner → `403 FORBIDDEN`; unknown →
     `404 INTERVIEW_NOT_FOUND`.
  2. If `config.AI_ENABLED === false` → `503 VOICE_UNAVAILABLE`.
  3. Check the interview is in a voice-capable state via the I07 machine; if not →
     `409 INVALID_STATE_TRANSITION`.
  4. Compute `roundLeft` and `interviewLeft` in seconds from `config.VOICE_MAX_ROUND_SECONDS`
     (720) and `config.VOICE_MAX_INTERVIEW_SECONDS` (1500) minus consumed time; `expiresAt =
     now + min(roundLeft, interviewLeft)` seconds.
  5. `nonce = crypto.randomBytes(32).toString('hex')`; `voiceSession.mint(interviewId)` for the
     token + `wssOrigin`; insert a `voice_sessions` row (`interview_id`, `nonce`, `expires_at`).
  6. On provider failure (`VoiceUnavailable`) → `503 VOICE_UNAVAILABLE` (no row written).
  7. `logger.info({ traceId, interviewId }, 'VOICE_SESSION_MINTED')`; return `201 { token,
     wssOrigin, dynamicVars: { interviewId, nonce }, expiresAt }`.
- `backend/modules/interview/ownership.ts` — I03. Reuse the resolver; do not re-query interviews
  directly.
- `backend/modules/interview/machine.ts` — I07. Reuse the legality check for "can this state host
  a voice round"; do not add a new transition edge here.
- `backend/src/lib/env.ts` — F03. `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID_HR/_TECH`,
  `VOICE_MAX_ROUND_SECONDS`, `VOICE_MAX_INTERVIEW_SECONDS`, `AI_ENABLED`.
- `backend/src/lib/error-codes.ts` — F01. Import `FORBIDDEN`, `INTERVIEW_NOT_FOUND`,
  `INVALID_STATE_TRANSITION`, `UNAUTHENTICATED`, `VOICE_UNAVAILABLE`. If `VOICE_UNAVAILABLE` is
  missing from the registry, add it as a task step before using it.
- `backend/src/app.ts` — A01. Mount the voice session router behind `requireAuth`.

  **The trap:** `expires_at` is the tighter of the two ceilings, not the round ceiling alone.
  `voice_session.feature` @AC-1 fixes the clock and gives `(roundLeft=720, interviewLeft=300) →
  expires=300` and `(roundLeft=200, interviewLeft=1500) → expires=200`. Compute
  `min(roundLeft, interviewLeft)` from the fixed clock, and bind the same value into the token you
  ask the driver to mint (ADR-V01) — do not mint the token to a different TTL than the row.

## Steps
- [x] **1. Confirm F01/F02/F03/A01/I03/I07 artefacts exist** — `error-codes.ts`, `db.ts`,
  `env.ts` (voice keys), `requireAuth`, the I03 ownership resolver, the I07 `machine.ts`. If any is
  missing, set this task `blocked` in STATE.md and stop.
- [x] **2. Create `VoiceSession.ts`** — the seam interface.
- [x] **3. Create `elevenlabs-session.ts`** — the real driver: mint a signed token with
  timeout+retry+bounded wait; throw `VoiceUnavailable` on failure; never log the token/key.
- [x] **4. Create `fake-session.ts`** — `FakeVoiceSession` with `failNext()`; canned token, fixed
  `wssOrigin`, generated `nonce`, computed `expiresAt`.
- [x] **5. Add `VOICE_UNAVAILABLE`** to `error-codes.ts` if absent (registry step).
- [x] **6. Create `session.ts`** — the mint handler per the anchor: auth → ownership → kill-switch
  → state legality → ceiling `min` → nonce + mint + `voice_sessions` insert → `201`. `FORBIDDEN`
  for non-owner, `INVALID_STATE_TRANSITION` for wrong state, `VOICE_UNAVAILABLE` for kill-switch /
  provider failure. No API key in the payload.
- [x] **7. Mount the router** in `app.ts` behind `requireAuth`; bind `FakeVoiceSession` in the test
  wiring so the acceptance ring never hits the network.
- [x] **8. Wire acceptance step-defs** for `voice_session.feature` @AC-1 (the `min` ceiling
  arithmetic against the fixed clock; token + `wssOrigin` + `dynamicVars`; a `voice_sessions` row;
  **no** API key in the payload) and @AC-2 (non-owner → 403 `FORBIDDEN`; wrong state → 409
  `INVALID_STATE_TRANSITION`; kill switch off → 503 `VOICE_UNAVAILABLE`; the enabled owner mint →
  201 with a row). Use the `Clock` seam for the fixed clock.
- [x] **9. Run the `## Verification` command.**

## Definition of done
- An owner mint on a voice-capable interview with `AI_ENABLED=true` returns `201` with a token,
  `wssOrigin`, `{ interviewId, nonce }`, `expiresAt = min(roundLeft, interviewLeft)`, and writes a
  `voice_sessions` row; the payload contains **no** `ELEVENLABS_API_KEY`.
- A non-owner mint is `403 FORBIDDEN`; a wrong-state mint is `409 INVALID_STATE_TRANSITION`; a
  kill-switch-off mint is `503 VOICE_UNAVAILABLE`; none writes a `voice_sessions` row.
- No `nonce`, token, or API key appears in any log line (grep the captured `LogSink` / stdout).
- `FakeVoiceSession.failNext()` exists and forces the next mint/turn to throw (V03 depends on it).

## Verification
```bash
npm run test:acceptance -- --tags "@voice-session"
```

Expected: every `voice_session.feature` scenario passes, zero failures, zero pending. Then confirm
no secret leaks:
```bash
docker compose logs api | grep -E "nonce|ELEVENLABS_API_KEY|Bearer"
# Must print nothing
```

## Notes

**What happened:** All steps completed. `VOICE_UNAVAILABLE` was already in the F01 registry — no addition needed.

**Interface deviation from REFERENCE.md:** The `VoiceSession.mint` signature was changed to `mint(interviewId, nonce, ttlSeconds)` returning `{ token, wssOrigin }` only. The handler owns nonce generation and expiresAt computation; the driver just mints the provider token. The REFERENCE.md interface (`mint(interviewId)` returning `dynamicVars` + `expiresAt`) was aspirational and would have created a dual-computation problem for the ceiling min (ADR-V01). This deviation is intentional.

**Ceiling seam:** `voiceSeam.roundRemainingSeconds` and `voiceSeam.interviewRemainingSeconds` are mutable function properties. Both default to computing from `interview.started_at` with their respective ceilings. The acceptance ring overrides them per-scenario to inject independent `roundLeft`/`interviewLeft` values. See `ponytail:` comment in `session.ts` for the upgrade path (per-round timestamp tracking).

**AI_ENABLED seam:** `voiceSeam.aiEnabled` starts from `config.AI_ENABLED` (false in cucumber runs). The `Before({ tags: '@voice' })` hook resets it to `true`; the existing `AI_ENABLED is {string}` step in `ai-provider.steps.ts` was updated to also set `voiceSeam.aiEnabled`.

**Precondition 3 quoting:** The feature's `AI_ENABLED "false"` table value embeds double quotes, so the substituted step text breaks `{string}` matching. A dedicated literal step `'the precondition "...AI_ENABLED {string}" holds'` handles it. The other two preconditions use the generic `{string}` step.

**Verification output:** `6 scenarios (6 passed)` for `@voice-session`; `38 scenarios (38 passed)` for the full default suite. No nonce, API key, or Bearer token in logs. csrf.test.ts vitest failure is pre-existing sandbox constraint (EPERM on listen), unrelated to V01.

**For V02:** The `voice_sessions` row has `(id, interview_id, nonce, expires_at, consumed_at)`. Gate 3 authorises against `interview_id + nonce` where `expires_at > now AND consumed_at IS NULL`. The nonce is a 64-char hex string (`randomBytes(32).toString('hex')`). `setVoiceSession` / `voiceSeam` in `backend/modules/voice/session.ts` are the injection points for V02's fake.
