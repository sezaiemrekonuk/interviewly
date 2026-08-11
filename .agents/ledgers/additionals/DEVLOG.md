# Additionals — devlog

## 2026-08-11 — `change_avatar` tool

Added the tool the interviewer's turn can carry (`avatar: 1|2|3` on `ConductorTurnSchema`) to
swap its own live expression, HR persona and technical persona each getting three independent
slots. See `DECISIONS.md` ADR-ADD01 for the reasoning; this is just what changed and where.

**Backend**

- `packages/ai/src/schemas.ts` — `avatar` optional field on `ConductorTurnSchema` (1..3).
- `packages/ai/prompts/interview.conduct.turn.v3.prompt.yaml` — new version (v1/v2 untouched,
  K9). Adds a "YOUR EXPRESSION" instruction and `avatar` to the reply-JSON template.
- `backend/modules/interview/avatar.ts` — new. `currentAvatar(interviewId, personaId)` (Redis
  read, defaults/clamps to 1) and `applyAvatarChange(...)` (clamp → compare → write + SSE
  publish, no-op when the request repeats the live value).
- `backend/modules/interview/avatar.test.ts` — unit test: clamp on read, no-op on repeat,
  write+publish on a real change, ignore out-of-range. Mocks `redis` and `./sse`.
- `backend/modules/interview/conductor.ts` — `personaForRound` now returns the persona `id`
  (was name + system_prompt only); after a turn comes back, `turn.avatar` (if present) calls
  `applyAvatarChange`, best-effort, logged on failure, never blocking the turn. `ConductorReply`
  gained the `avatar?: number` field.
- `backend/modules/interview/sse.ts` — new `AVATAR_CHANGED = 'INTERVIEW_AVATAR_CHANGED'` const;
  `eventNameFor` recognizes it so the stream sends the right event name.
- `backend/modules/interview/state.ts` — `resolvePersonas` reads `currentAvatar` for the active
  persona and adds `avatar` to the `persona` object in `GET /state`'s response.

**Frontend**

- `frontend/src/lib/query.ts` — `InterviewStateResponse.persona` gained `avatar: number`.
- `frontend/src/lib/use-interview-events.ts` — `INTERVIEW_AVATAR_CHANGED` added to the nudge
  list (still payload-blind, per the room's SSE contract).

**Verified**

- `npm test` — 103 files / 1003 tests pass (new `avatar.test.ts` included).
- `npm run typecheck` — clean.
- `eslint` on every touched file — 0 errors (2 pre-existing ignore-pattern warnings, unrelated).

**Not done here (see ADR-ADD01 "Skipped"):** no avatar images, no `persona-tiles.tsx` wiring —
that component doesn't render an `<img>` at all yet. The backend now hands the room everything
it needs (`persona.avatar`, an SSE nudge on change); rendering it is a `frontend`/`interview-core`
task for whoever owns those ledgers.

## 2026-08-11 — real avatar art seeded

Owner supplied 6 photos (`~/Downloads/out/square/*_pose{1,2,3}.png`, 256×256): 3 poses each of
a man and a woman. Mapped woman → Ada (HR), man → Turing (tech) — the two persona names read
that way, and the mapping is a one-line swap if wrong.

- Copied into `backend/prisma/fixtures/avatars/{ada,turing}-{1,2,3}.png` (repo-tracked, small
  enough not to need LFS).
- `backend/prisma/seed.ts`: `putImage` now takes real bytes + content type (defaulted to the
  existing placeholder webp, so every other call site — mascot, the 5 `AvatarState` keys — is
  unchanged). `seedPersonas` uploads the 3 fixtures per persona at
  `personas/{personaId}/expr-{n}-{sha256_of_real_bytes}.png`, `avatar_set[expr-n]`, content-
  addressed by the actual file (not the shared placeholder sha, since these three really
  differ). This is exactly the key the `change_avatar` tool (`avatar.ts`) and `GET /state`'s
  `persona.avatar` were already built to point at — no change to either.
- **Verified against the running stack**, not just unit tests: rebuilt the `api` image,
  temporarily published dev ports (`compose.dev.yaml`) and ran `npm run seed` (via a transient
  `npm install tsx` — the runner image ships no dev deps, so the seed script only runs from a
  full checkout or with tsx added ad hoc). Confirmed in Postgres that both personas' `avatar_set`
  now carries three `expr-*` PNG keys with distinct real shas, confirmed those objects serve as
  `200 image/png` at the real file size through the edge (`/assets/personas/.../expr-*.png`),
  and re-ran the seed a second time to confirm the upsert is still a no-op (same shas, same
  keys). Reverted the container back to its normal state and ports afterward.
- Still not wired into `persona-tiles.tsx` (see the entry above) — the real art is at the
  expected keys, ready for whenever that UI task happens.


## 2026-08-11 — the expressions on screen, and the candidate's own camera

The backend half of `change_avatar` had nowhere to show up, and the candidate had no camera on
any screen. Both are frontend-only; nothing on the wire changed. See DECISIONS.md ADR-ADD02.

**The interviewer's face**

- `frontend/src/components/avatar.tsx` — `AvatarSet` is now `Record<string, string | undefined>`
  (the set holds `AvatarState` keys and `expr-n` ones), new `expression?: number` prop, and the
  failure state is the key that failed rather than a boolean. Inline styles moved to the new
  `avatar.module.css`; `ui-checks/grounds.test.ts`'s `KNOWN_DEAD` exemption list is now empty.
- `frontend/src/components/room/persona-tiles.tsx` — every tile draws its persona: 176px above
  the waveform on the speaker, 40px beside the name on the small ones. New `activeExpression`
  prop (default 1) applies only to the tile whose id matches `activeId`.
- `frontend/src/app/[locale]/interviews/[id]/room/page.tsx` — passes
  `activeExpression={room.persona?.avatar ?? 1}`. The SSE nudge that already refetches `/state`
  is what brings a new expression down; there is no second path.
- `frontend/src/components/room/room.module.css` — `.portrait`, `.portraitSm`, `.presence`
  (face over voice, centred), `.tileWho`, `.selfCam`.

**The candidate's camera**

- `frontend/src/components/camera-view.tsx` + `.module.css` — new, used by both surfaces. `off`
  renders the empty frame and asks for nothing; enabling mounts the capture, which requests
  `{ video: true, audio: false }`, binds it to a muted mirrored `<video>`, and stops the tracks
  on unmount. `blocked` / `unavailable` are sentences in the frame, never an error.
- `frontend/src/app/[locale]/interviews/[id]/pre-join/page.tsx` — a second panel under the mic
  check: preview, one toggle, and the note about where the picture goes (nowhere). It never
  affects the CTA — only the microphone does.
- `frontend/src/components/room/voice-controls.tsx` — a `Camera on/off` control beside Captions,
  stated in words like every other toggle in the bar (DESIGN §5). `page.tsx` owns the flag.
- `frontend/src/lib/use-mic-permission.ts` — comment corrected: it is the microphone half of the
  gate now, and must still never ask for video.
- Copy: `common.camera.*` (the four frame states), `preJoin.camera.*`, `room.camera`, and a
  pre-join title/subtitle that names the camera. en + tr.

**Verified**

- `npm test` — 105 files / 1015 tests pass. New: `camera-view.test.tsx` (nothing requested while
  off, video-only when on, track stopped on toggle-off and on unmount, refusal vs no-device),
  `persona-tiles.test.tsx` (speaker draws the asked-for slot, everyone else slot 1, camera
  replaces the waveform on the candidate tile only). Extended: `voice.test.tsx` (the control-bar
  toggle, both ways), `pre-join/page.test.tsx` (no video request until the click).
- `npm run typecheck` + `tsc -p frontend` — clean. `eslint --max-warnings=0` on every touched
  file — clean, including `react-hooks/set-state-in-effect`, which is what shaped both the
  `Capture`/`Frame` split and the failed-key state in `Avatar`.
