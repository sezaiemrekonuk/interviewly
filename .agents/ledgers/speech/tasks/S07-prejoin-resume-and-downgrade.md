# S07 — Pre-join on resume, mic-denied downgrade, and the transient-audio copy
REPO: (this repo) · Depends: S06, V03, W09 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — one routing ternary, one call to the already-written
`voiceDowngrade`, and a copy change in two locales. Small, but the copy change is a privacy
claim: take the wording from ADR-S07, do not improvise it.

## Goal
Owner's ask:

> "Mikrofon yoksa kullanıcı çıkmaza düşmesin, ve geçmişten devam ederken de aynı kontrol olsun."
> — issues #87 and #88; ADR-S07; speech spec AC-10

Closes the two pre-join gaps: a denied microphone is currently a dead end with no way forward,
and an interview resumed from the history list skips the device check entirely. Also changes the
pre-join copy to tell the truth about where the answer audio goes.

## Security boundaries
- **The copy is the deliverable, not decoration.** Pre-join today implies nothing leaves the
  browser. Under ADR-S02 the answer audio is uploaded to our server and forwarded to ElevenLabs.
  The new copy says: the answer audio is sent to be transcribed and is not kept. Both locales,
  same meaning — a privacy claim that differs between `en` and `tr` is worse than one that is
  only in English.
- **This does not build the consent surface #61 tracks.** It keeps this ledger from making that
  issue worse. Do not add a consent checkbox and call KVKK done.

## Non-negotiables
- **A denied microphone downgrades; it never blocks.** `voiceDowngrade()` exists, is documented
  for exactly this case, and has zero call sites (`frontend/src/lib/voice/downgrade.ts:1-9`).
  Call it. Do not write a second downgrade path.
- **`unavailable` and `denied` both get a way forward.** Today `mic === 'unavailable'` removes
  the CTA and `denied` disables it (`pre-join/page.tsx:83-96`). Both are dead ends; both
  downgrade.
- **Resume routes on mode.** `interview.mode` is already on every history row
  (`lib/query.ts:180`) — the branch costs one ternary and no extra fetch.
- **No provider call happens before Join.** A downgrade at pre-join must leave zero `llm_calls`
  rows for that interview.

## Context (anchors)
- `frontend/src/lib/voice/downgrade.ts:7` — `voiceDowngrade(interviewId)`. Written, unimported.
- `backend/modules/voice/session.ts:107,116` — `preJoinDowngrade` and its route. Live and
  correct; S05 keeps them.
- `frontend/src/app/interviews/[id]/pre-join/page.tsx:83-96` — the dead end, both halves.
- `frontend/src/components/home/interview-row.tsx:76-80` — the unconditional Continue link.
  `RESUMABLE.has(interview.state)` is already the guard; add the mode branch beside it.
- `frontend/src/app/interviews/new/page.tsx:67-71` — the create-time routing this must match.
- `frontend/messages/{en,tr}.json` — the pre-join copy.

## Steps
- [ ] **1. Test red** — a denied `getUserMedia` at pre-join produces a `mode='text'` interview
  with zero `llm_calls` rows; a voice interview resumed from history lands on `/pre-join`, not
  `/room`. See both red.
- [ ] **2. Denied and unavailable both call `voiceDowngrade`**, then route to the room in text
  mode with a line saying what happened. `errors.VOICE_UNAVAILABLE` copy already exists in both
  locales (`messages/{en,tr}.json:273`) and has never been shown.
- [ ] **3. Resume branch** — `interview.mode === 'voice' ? '/pre-join' : '/room'` in
  `interview-row.tsx`.
- [ ] **4. Transient-audio copy** — rewrite the pre-join privacy line in both locales per
  ADR-S07.
- [ ] **5. Unit test** — the mode branch on the history row; the downgrade call on both mic
  failure states.

## Definition of done
- speech AC-10 green.
- `voiceDowngrade` has call sites; a repo grep no longer shows it importable but unimported.
- Denying the mic ends in a working text interview, not a disabled button.
- The pre-join copy states where the answer audio goes, identically in both locales.

## Verification
```bash
npm run -w frontend test -- pre-join home/interview-row
grep -rn "voiceDowngrade" frontend/src
```
Expected: tests green; the grep shows the definition plus at least one call site in
`app/interviews/[id]/pre-join/`.

## Notes
