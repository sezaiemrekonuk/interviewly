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

## 2026-08-11 — the tiles became a meeting (owner review)

Owner's read of the first pass: the portrait floated in the middle of a card, and the candidate
had to click to see themselves. Both fixed; the shape is a call surface now.

- `persona-tiles.tsx` — new `VideoTile`: the picture fills the tile, the name plate sits
  bottom-right, LIVE top-right, the drawn voice bottom-left, and the candidate's tile is the
  same tile with their camera in it (mic meter pinned across its foot). Text mode's strip is
  untouched — `PersonaTile` takes a `video` flag and keeps the old row for it.
- `room.module.css` — `.videoTile`/`.videoLead`/`.videoSmall`, `.portraitFill`, `.plate`,
  `.badgeFloat`, `.waveFloat`. The old `.tileLead` rules are deleted, not left dead.
- `avatar.module.css` — no geometry at all now (no radius, no size): the caller's class owns it,
  or two stylesheets fight over which loaded last.
- `camera-view.tsx` — `rememberCamera()` / `cameraStartsOn()`. The room opens with the camera
  already running when the candidate turned it on in pre-join (`sessionStorage`, per tab) or
  when this browser has already granted the permission (`permissions.query`, which cannot
  prompt). Firefox has no camera descriptor there, so it falls back to the click.
- Pre-join is **one** panel for both devices (owner: "same container like Google Meet") —
  preview, its toggle, a rule, then the microphone check and the privacy note.

`npm test` 51 files / 529 tests pass; typecheck and eslint clean; `web` rebuilt and healthy.

## 2026-08-11 — square tiles, and pre-join as a call lobby (owner review, second pass)

- `room.module.css` — every meeting tile is `aspect-ratio: 1` now. The speaker takes the stage's
  height and centres in the width it leaves; the side tiles take their column's width and centre
  in the height; grid view is three equal squares. The previous pass let the speaker's tile fill
  a 1150×580 cell, which cropped one face into a letterbox.
- `pre-join` is a lobby, not a form (owner: "make it look exactly like this" — Meet's pre-join):
  a 16:9 preview card with the candidate's label in the top-left corner and two round device
  controls floating over its foot, the microphone's readout under it, and the way in — heading
  plus CTA — in its own column beside it. `--container-max` 480px → 1040px; one column under
  60rem.
- The round controls are the one place in this product where an icon carries state, so it is
  carried twice: a slash through the glyph *and* a `--danger` fill. Inline SVG, two paths, no
  icon dependency.
- `mic-check.tsx` is presentational now — it takes the `useMicPermission` result as a prop. The
  page owns the hook because the mute button sits on the preview, outside the component; that
  also deleted the report-upwards effect and the local mirror of `state` the page kept.
- Copy: `preJoin.you` / `ready` / `mute` / `unmute` / `muted`, en + tr.

`npm test` 51 files / 530 tests pass (new: the lobby mutes without closing the gate); typecheck
and eslint clean; `web` rebuilt and healthy.

## 2026-08-11 — listing check, and the interview language the interviewer can set

ADR-ADD03. What changed and where.

**AI package**

- `prompts/interview.listing.validate.prompt.yaml` — new lineage, v1, `gpt-4.1-nano`, temp 0.
  Returns `{"is_job_listing":…,"language":"en|tr"}`; text that tries to steer it is by that fact
  not a listing.
- `prompts/interview.conduct.turn.v4.prompt.yaml` — v3 verbatim plus THE INTERVIEW LANGUAGE and
  WHEN YOU DID NOT UNDERSTAND, and a tightened HOW MUCH TO PROBE. v1–v3 untouched (K9).
- `src/schemas.ts` — `InterviewLanguageSchema` (`en|tr`), `ListingCheckSchema`, and
  `set_interview_language` on `ConductorTurnSchema`.
- `src/AiClient.ts` / `live-client.ts` / `stub.ts` / `resolve-client.ts` / `prompt-vars.ts` /
  `index.ts` — `validateListing` through the seam, 8 s timeout. The stub accepts every listing
  and reads its language with `detectLanguage`, so a keyless Turkish run still runs in Turkish.

**Backend**

- `src/lib/error-codes.ts` — `LISTING_NOT_A_JOB` (422).
- `modules/interview/setup.ts` — `checkListing` after `create`: refuse → soft-delete + 422 before
  the quota is charged; accept → write the listing's language onto the interview and title it in
  that language.
- `modules/interview/language.ts` — `setInterviewLanguage`, the same write `trackLanguage` makes,
  reached from the conductor's tool call. Guarded by `SUPPORTED`, clears the streak.
- `modules/interview/conductor.ts` — applies `turn.set_interview_language` before the avatar hook
  and before anything generates.
- Deleted `src/lib/error-codes.{js,d.ts}` — committed build artifacts sitting next to the source.
  Vitest resolved the stale July `.js` over the `.ts`, so every code added since (CONSENT_REQUIRED,
  REPORT_ALREADY_EXISTS, SPEECH_*, and this one) read as `undefined` under test.

**Frontend**

- `messages/{en,tr}.json` — `LISTING_NOT_A_JOB`. The new screen needs no code: `errorMessage(code)`
  already renders whatever the setup call refuses with.

`npm test` 112 files / 1122 tests pass; typecheck and eslint clean.
