# S10 — Speech failure codes surfaced honestly in the room
REPO: (this repo) · Depends: S06 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — reading a code that `ApiResult` has carried all along and branching
copy on it. The work is enumerating the failure modes; the spec's table already does that.

## Goal
Owner's ask:

> "Hata çıkınca ne olduğunu anlayayım, çalışmayan bir butona basmayayım."
> — issue #55; speech spec *Failure modes*, AC-13

Every speech refusal currently renders the same "The voice connection dropped. Your interview is
safe — reconnect to keep going." and a Reconnect button that re-issues the same refusal forever.
This replaces one wrong sentence with the right one per failure.

## Non-negotiables
- **Every failure gets copy that is true and an action that can succeed.** A Reconnect button
  offered against a 403 is worse than no button: it teaches the candidate that the product is
  broken and that trying again is their job.
- **"Connection dropped" is retired with the connection.** After S05 and S06 there is no
  WebSocket to drop. Any surviving instance of that string is a lie about an architecture that
  no longer exists.
- **Both locales, same meaning.** `en.json` and `tr.json` change together. Turkish register
  follows whatever #111 settles; if it is unsettled, match the surrounding file rather than
  inventing a third style.
- **The code comes off the response, not from a guess.** `ApiResult<T>` already carries
  `code: string | null` (`lib/api.ts:11-16`) and the room already discards it
  (`use-voice-session.ts:98-104`). This task stops discarding it.

## Context (anchors)
- `frontend/src/lib/api.ts:11-16` — `ApiResult<T>.code`, documented and unread.
- `frontend/src/lib/use-voice-session.ts:98-104` — where the code is dropped today, and where the
  comment assumes every failure was already downgraded server-side.
- `frontend/src/components/room/voice-controls.tsx:19,25-27` — `status === 'lost'` renders
  `t('voice.lost')` plus Reconnect, unconditionally.
- `frontend/messages/en.json:210-220` — the `room.voice.*` block.
- `frontend/messages/en.json:273` / `tr.json:273` — `errors.VOICE_UNAVAILABLE`, the correct copy
  for a downgrade, present in both locales and never shown.
- `frontend/src/lib/error-routing.ts` — the existing code→action mapping to extend rather than
  duplicate.
- The speech spec's `## Failure modes` table — the complete list, with the code and the effect
  for each.

## Steps
- [x] **1. Test red** — each code in the spec's failure table renders its own copy and its own
  action; none renders `voice.lost`. See it red.
- [x] **2. Read the code** — thread `code` from the failed request to the room state instead of
  collapsing every failure to `lost`.
- [x] **3. Copy per failure** — `VOICE_UNAVAILABLE` (continue in text, already written),
  `SPEECH_AUDIO_INVALID` (re-record), `SPEECH_TRANSCRIPTION_FAILED` (retry or type),
  `VOICE_SESSION_EXPIRED` (time is up, go to the report), `FORBIDDEN` / `INVALID_STATE_TRANSITION`
  (this interview cannot continue in voice). Both locales.
- [x] **4. Action per failure** — Reconnect only where reconnecting can work. Elsewhere: continue
  in text, re-record, or leave.
- [x] **5. Retire `voice.lost`** or narrow it to the one case that still means it.
- [x] **6. Unit test** — a 403 renders no Reconnect button.

## Definition of done
- speech AC-13 green.
- Every code in the spec's failure table has distinct copy in both locales.
- No failure renders a control that cannot succeed.
- Grep for `voice.lost` shows it used only where a connection can actually drop, or not at all.

## Verification
```bash
npm run -w frontend test -- room/voice-controls use-voice-session
grep -rn "voice.lost" frontend/src frontend/messages
```
Expected: tests green; the grep shows no use against a non-recoverable failure.

## Notes

S06 already threads `code` into `session.error`; S10 was component-only — no hook change needed.

- **Copy lives in `room.voice.failure.<code>`, not the `errors` namespace.** A 403 in the room
  is "this interview cannot continue in voice", not the generic "no permission"; the ceiling is
  "time is up, going to your report", not "start it again". `voice-controls.tsx` reads
  `voice.failure.<code>` and falls back to `useErrorMessage` for unmapped codes.
- **Action gate is `RETRYABLE_CODES`** (`SPEECH_AUDIO_INVALID`, `SPEECH_TRANSCRIPTION_FAILED`,
  `UNKNOWN`) — the only failures a re-record clears. Every other code renders copy alone: the
  room resolves them itself (`VOICE_UNAVAILABLE` refetch→text, `VOICE_SESSION_EXPIRED`
  refetch→report) or cannot continue in voice at all (403).
- **`voice.lost` retired.** Renamed the key to `voice.micLost` with mic-honest copy (the mic can
  drop; the connection S05 deleted cannot). `voice.status.lost` chip reworded "Disconnected"→
  "Mic off". Grep for `voice.lost` is now empty.
- Covers the STATE tech-debt line **[S05→S10]**: the room's mic-lost banner + reconnect now has
  a test (`session-lost` names the mic, not a connection, and its reconnect fires).
- **Issue 112's guard was amended, not bypassed.** `ui-checks/error-codes.test.ts` forbade any
  code-shaped key outside `errors` — the rule that catches copy shadowed where `useErrorMessage`
  can never reach it. `room.voice.failure` is a deliberate override read by a component, so it
  is exempted by name and two new assertions replace what the exemption gives up: every key in
  it is a real registry code, and both locales override the same set.
- `voice.test.tsx`'s W10 failure test asserted `messages.errors.SPEECH_AUDIO_INVALID`; it now
  asserts the room's own copy for the same code.
- Verified: full `npm run -w frontend test` 476/476 across 48 files (the narrower
  `-- room/voice-controls use-voice-session` selection is 27/27 but missed both regressions
  above); grep clean; root `npm run lint` + `npm run typecheck` green, and the changed files
  pass pre-commit's stricter `frontend/eslint.config.mjs`. No acceptance feature covers AC-13 —
  it is a frontend copy criterion, held by the unit tests.
