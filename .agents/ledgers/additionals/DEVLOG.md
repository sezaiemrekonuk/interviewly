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

## 2026-08-12 — the report's score chart, and seven owner-reported defects

ADR-ADD04. Eight items in one pass; what changed and where.

**Report — the chart (feature)**

- `components/report/score-trend.tsx` — new. One column per scored answer, grouped by round,
  each column printing its own score above it and its round's name under the group, with a
  dashed baseline through `overall_score`. Pure SVG, every value an attribute; `--series-1` and
  `--series-3` come in through `report.module.css` classes. Wide charts scroll inside
  `.trendScroll`, so a ten-question interview never scrolls the page sideways.
- `components/report/report-view.tsx` — renders it between the verdict sentence and Rounds, and
  only from two answers up. The points come off `rows`, which already joins each scored question
  to its transcript turn — that turn is where `roundType` lives.
- `messages/{en,tr}.json` — `report.trendTitle`, `report.trendCaption`.

**Report — the download (fix)**

- `worker/src/render-pdf.ts` — `ReportPdfMeta.interviewId` is gone, replaced by `occupation`.
  The header line and the PDF `Title` name the role instead of the cuid; a null occupation falls
  back to "Practice interview".
- `worker/src/finalize.ts` — one `include` for the interview's occupation.
- `backend/src/lib/storage.ts` — `signedUrl` takes an optional `filename` and presigns
  `ResponseContentDisposition` with it. `backend/modules/interview/download.ts` passes
  `interviewly-report-<yyyy-mm-dd>.pdf`, off the report's own `created_at`. The object key is
  unchanged.

**Room**

- `components/room/persona-tiles.tsx` — the text-mode roster's green `LIVE` badge and the
  four-bar glyph beside it are deleted (owner: remove it). The tile still carries `data-live`,
  which is what the CSS and the room's own test read. `room.module.css` lost `.liveBadge`,
  `.mini` and their four overrides with it; `room.live` stays in both message files because the
  voice test asserts the string is *absent*.
- `components/room/room.module.css` — the mute/camera split control: the switch half painted a
  transparent border while the welded caret painted a real one, so the pair read as a bordered
  box hanging off nothing. The split rules are now scoped to `.group:has(.caret)` (a caret-less
  switch keeps its own radii), the switch takes `--border` when it is not in the danger state,
  and both halves carry the app's focus ring at `z-index: 1` so the neighbour cannot clip it.

**Landing chrome**

- `chrome.module.css` — the scrolled header is iced glass now: `blur(32px) saturate(180%)` over
  62% `--surface`, up from a 12px blur at 78%. Sign in became a real control (padding and a
  `--surface-sunken` hover bed rather than a colour change alone), and Try now carries the rail's
  ink with a hairline lift. Neither is orange: the hero still owns the page's one `--primary`.

**Archive**

- `app/[locale]/interviews/page.tsx` — the sessions sort is the house `<Select>` now, not a bare
  native one. That is what fixes the arrow with nothing between it and the border: `appearance:
  none` plus a drawn chevron at 16px inside a 44px right padding, which `components/ui` already
  owned. The local `.select` is four lines of override.
- `components/interviews/question-table.tsx` — the question view offered `recent` and `worst`
  only; `oldest` and `best` are in, over the same comparator shape the sessions list uses
  (unscored rows last under *both* score sorts). `messages/{en,tr}.json` gained the two labels.

`npm test` 121 files / 1253 tests pass (new: three on the chart's geometry, two on the added
sorts); typecheck and eslint clean.

## 2026-08-12 — the landing is the room now, and the front door is public

Two asks from the owner, one branch. The homepage read as slop and bored people off the page;
and `/` redirected anyone with a session, so a customer could never see it. See DECISIONS.md
ADR-ADD05 and ADR-ADD06.

**The cast**

- `frontend/src/components/home/peeps.tsx` + `peeps.module.css` — new. `<Peep name="ada"|"turing"
  mood={…} />`, inline SVG, six moods (idle / listening / asking / marking / pleased /
  unconvinced) over a shared bust. Ada is long hair and a hoop; Turing is round glasses and
  headphones. Every stroke is `currentColor`, every fill a token, so nothing here trips the hex
  scan and nothing requests an object. Blink is CSS, offset per character, and gated on
  `prefers-reduced-motion: no-preference`.

**The dark act**

- `frontend/src/components/home/handover.tsx` + `handover.module.css` — new, and the whole first
  screen: headline, the page's one `--primary`, the listing sheet with the role chips on it, the
  sticky two-tile cast column, the exchange, and the assembled sample report. Replaces
  `demo-interview.tsx` + `landing.module.css`, both deleted. The state machine, the typing hook,
  the settle-from-zero meters, the post-mount shuffle, the sizing span and the focus move all
  came across unchanged; the staging, the cast and the motion are new.
- `frontend/src/app/[locale]/page.tsx` + `page.module.css` — rewritten. The page is now the dark
  act, then five quiet light bands, then a dark closing bookend with both characters. The
  three-step band became a flow diagram whose hairlines draw on scroll; the languages band has
  Turing asking the same question between the two quotes.
- `frontend/src/components/chrome/{header.tsx,chrome.module.css}` — `SiteHeader` takes `onDark`,
  which gives the bar the rail's material. Set on the landing only. The five section anchors get
  `.navSection` and are hidden below 48rem, where they wrapped the header into a 320px stack over
  the headline.

**The front door**

- `frontend/src/components/home/home-switch.tsx` — deleted. Its only job was the redirect off `/`.
- `frontend/src/components/auth/anonymous-only.tsx` + test — new. The inverse guard, on
  `/sign-in`, `/register` and `/forgot-password` only. `safeReturnPath` then `firstRunPath`,
  `router.replace`, fails open, carries its own `<Suspense>` so the pages stay prerenderable.
- `frontend/src/components/chrome/header-nav.tsx` — both actions for everyone, same labels; only
  the href changes once `probeSession()` answers. The issue-95 tri-state is gone with the reason
  for it.
- `frontend/src/test/fetch.ts` — the shared `stubFetch` answers `/api/me` 401 and `formCalls`
  excludes it, which is the root fix for the auth page tests now that a guard mounts in them.
- Stale doc comments in `lib/auth-redirect.ts`, `shell/split-shell.tsx` and `home/demo-content.ts`
  corrected — all three described the redirect or the deleted demo file.

**Verified**

- `npm test` — 122 files / 1259 tests pass.
- `npm run typecheck` — clean. `eslint` on every touched file — clean.
- `next build` — succeeds, all 21 routes.
- In a browser at 1440 and at 390, English and Turkish: the lamp-up, the mark landing with Ada's
  face changing on it, the handover to Turing, the drawn flow hairlines, and the closing bookend.

**Also added:** `PRODUCT.md` at the repo root. `AGENTS.md` has cited it since 2026-08-07 as the
holder of product truth and what the marketing page may claim; it had never actually been
written, and a redesign that decides what the landing page says is the wrong moment to still be
guessing. Facts only, plus an explicit list of what must never be fabricated (customers, logos,
benchmarks, prices, outcomes).

**Not done:** the report anatomy still says "out of five" while the demo prints "82 / 100" —
pre-existing, and a copy decision that should not be buried in a layout diff. The `--accent`
focus ring is 2.1:1 on the rail, under the 3:1 floor for a non-text indicator; that is the
app-wide recipe and wants one token decision rather than a second ring on this page.

## 2026-08-12 — the Google callback lands on the dashboard

Follow-up to the same day's entry, and a regression it caused. `/` stopped redirecting, but the
Google OAuth callback still 302'd there — so a Google sign-in ended on the marketing page. See
DECISIONS.md ADR-ADD07.

- `backend/modules/auth/google.ts` — the success redirect is `${PUBLIC_ORIGIN}/dashboard`.
- `backend/modules/auth/google-callback.test.ts` — the issue-80 test pinned the old destination
  by name; it pins the new one, and that the public landing is never the target again.
- `frontend/src/app/[locale]/dashboard/page.tsx` — the onboarding half of K8.7 at the
  destination: an account with no `onboardingCompletedAt` is replaced to `/onboarding/1` and the
  page renders `null` meanwhile. Not `firstRunPath`, which would bounce a zero-interview account
  to `/interviews/new` and make this page unreachable for them.
- `frontend/src/app/[locale]/dashboard/page.test.tsx` — the `/me` fixture carries
  `onboardingCompletedAt` and `interviewCount` now (it matched no real payload before), plus one
  case for the new bounce.

Password sign-in and register were already correct — both call `firstRunPath(user)` where the
session is issued — and are untouched.

**Verified:** `npm test` 122 files / 1260 tests pass; typecheck and eslint clean. In a browser
against a stubbed `/me`: an account with `onboardingCompletedAt: null` opening `/dashboard` lands
on `/tr/onboarding/1` (locale carried), and an onboarded one stays on `/tr/dashboard` with the
rail drawn.

## 2026-08-12 — cost analytics on the console: six chart forms over one time-bucketed read

The Costs section was three cards of all-time totals. `/admin/stats` had no notion of a date, so
nothing on the surface could answer "is this rising", "is the mix shifting" or "when does the
money land". See `DECISIONS.md` ADR-ADD08 for the reasoning; this is what changed and where.

**Backend**

- `backend/modules/admin/costs.ts` — new. `GET /admin/costs?days=7|30|90`. Four `Promise.all`
  aggregations over the window: `(day, provider, model)` on `llm_calls`, `day` on `interviews`,
  `(isodow, hour)` on `llm_calls`, and `(provider, model)` over the preceding window of equal
  length. Daily and platform totals are folded from the first query rather than queried again,
  so `totals.costUsd`, `sum(daily.costUsd)` and `sum(models[].costUsd)` are the same figure by
  construction. Exports `resolveDays`, `dayKeys`, `foldModels` and `MODEL_SERIES_LIMIT = 3`.
- `backend/modules/admin/costs.test.ts` — new. 15 unit tests on the pure helpers: the `days`
  whitelist and every rejection path, `dayKeys` across month and leap-day boundaries, and
  `foldModels` for dense zero-fill, top-N selection, the deterministic tie-break, the Other
  fold including a previous-window-only model, and the latency divide-by-zero guard.
- `backend/modules/admin/router.ts` — `GET /costs` under `adminStatsLimiter`, the same limiter
  and for the same reason as `/stats`.
- `backend/src/lib/audit.ts` — `admin.costs_read` added to the `AuditAction` union. An aggregate
  over every user's spend is still a read of their data (issue 86).
- `backend/prisma/schema.prisma` + `migrations/20260812120000_llm_calls_created_at_idx/` —
  `@@index([created_at])` on `llm_calls`. Not a prefix of the existing
  `[interview_id, created_at]`, so it is a genuine second btree insert on the hottest write
  path in the schema; every query above filters on a bare date range and would otherwise scan.

**Frontend**

- `components/admin/charts/geometry.ts` + `geometry.test.ts` — new. Pure SVG geometry:
  `niceMax`, `tickValues`, `labelledIndexes`, `bands`, `stackBands`, `donutSlices`. 20 tests,
  including that a stacked total overflowing its axis clamps rather than drawing above the plot,
  and that the donut's slices consume exactly one circumference.
- `components/admin/charts/series.ts` — new. The one place a model is mapped to a colour slot,
  a key, a label and its share, so the same model wears the same slot in the area, the bars,
  the donut, the table swatch and its sparkline.
- `components/admin/charts/charts.module.css` — new. Every colour the charts use, because a
  chart under `style-src 'self' 'nonce-…'` can carry geometry in attributes but never a fill.
- `components/admin/charts/trend-lines.tsx` — new. `SpendTrend` (daily total) and
  `PerInterviewTrend` (daily spend ÷ interviews started), both with a dashed mean the caption
  also states, and a dot on the last point only.
- `components/admin/charts/model-mix.tsx` — new. Stacked area, daily spend by model.
- `components/admin/charts/model-delta.tsx` — new. Grouped columns, each model over the range
  against the same span immediately before it. The previous bar is `--surface-sunken`, never a
  fourth hue.
- `components/admin/charts/model-share.tsx` — new. Donut over `stroke-dasharray`, model share
  of range spend.
- `components/admin/charts/model-table.tsx` — new. The exact figures, and therefore the
  accessible rendering of the three charts above it. One sparkline scale shared by every row.
- `components/admin/charts/spend-heatmap.tsx` — new. 7 × 24 UTC grid of `data-tier` cells,
  reusing the dashboard's `activityTier` and its `color-mix` ramp rather than a second one.
- `components/admin/charts/cost-charts.test.tsx` — new. 19 render tests: money printed
  verbatim, the Other row labelled rather than blank, the shared sparkline scale (the fixture's
  two models are 100× apart and byte-identical under a per-row max), every SVG `aria-hidden`
  with a captioned figure, a zeroed surface for each of the seven, the heatmap's deterministic
  peak, and the range control's single pressed state.
- `components/admin/cost-panel.tsx` — the range control, three figure cards (platform total,
  range spend with its delta, cost per interview) and the seven graphics. The per-model `Meter`
  list is gone; the per-occupation one stays, still labelled loaded-rows-only.
- `lib/query.ts` — `AdminCostsResponse`, `AdminCostModel`, `COST_RANGES`, `useAdminCosts`.
- `messages/{en,tr}.json` — 47 keys added under `admin.costs`; the four orphaned by the deleted
  `Meter` list were removed.
- `DESIGN.md` §W11 — a **Cost charts** block. "Bars, not charts" now points at it rather than
  reading as a blanket ban.
- `app/[locale]/admin/page.test.tsx` — a `/admin/costs` fixture in `stubFetch`; the assertion
  that named the deleted `admin-by-model` testid now checks the model is named in more than one
  graphic, which is the series-identity claim.

**Verified**

- `npm test` — 124 files / 1307 tests pass. `npm run typecheck` clean. eslint clean on every
  touched file.
- Read in the browser against the seeded stack at three ranges. Three defects found and fixed
  there rather than in review: the legend's `flex: 1 1 220px` was a 220px *height* in a column
  flex card (a dead band under two charts), the per-bar delta copy was a sentence that
  overlapped its neighbours, and the delta legend's swatch claimed the selected range was blue
  when the bars are one hue per model.

**Not done here (see ADR-ADD08 "Skipped"):** no per-cluster spend from the server, no hover or
tooltip layer, no CSV export, and the `--series-4/5/6` tokens stay in the registry unused by
these charts.

## 2026-08-12 — the filter moved into its table, and the cost charts became one panel

Two owner asks in one pass. The filter floated on `--bg` above whatever the section rendered,
and the Costs section had grown to seven stacked chart cards and 4400px. See `DECISIONS.md`
ADR-ADD09; this is what changed and where.

**The filter, into the container of the table it filters**

- `components/admin/{interview,call,session,user,audit}-table.tsx` — each gained an optional
  `filter?: ReactNode`, rendered as the last child of the `.head` it already had. Nothing else
  about the five shells changed; they were already identical, which is what made this one prop
  rather than five layouts.
- `components/admin/table.module.css` — one rule, `.filter`, a 12px flex column. No hairline
  above it: `.builder` carries its own border, and a rule 12px from that one is two lines.
- `app/[locale]/admin/page.tsx` — builds the node once behind the `meta ?` guard it already had
  and hands it to the section's table. The queue gets none, because it has no list.
- `app/[locale]/admin/interviews/[id]/page.tsx` — the drill-down had been rendering
  `FilterBuilder` inside `table.head` all along, flush against the heading. Both call sites now
  take the same `.filter` wrapper, so the console and the drill-down space it identically.

**The cost charts, into one panel**

- `components/admin/charts/plot.tsx` — new. The shared time-series shell (gutter, gridlines,
  ticks, axes, date labels) plus the marks that draw inside it: `LineMarks`, `AreaMarks`,
  `ColumnMarks`, `StackedAreaMarks`, `StackedColumnMarks`, `MultiLineMarks`. The plot grew to
  880 × 220 now that it owns the card alone.
- `components/admin/charts/chart-panel.tsx` — new. The card: a `Chart` select over six views, a
  `Drawn as` select over that view's applicable forms (absent when there is one), the range
  buttons, the body, and the `figcaption`. Holds the per-view type choice, so leaving a view and
  returning does not reset the drawing.
- `components/admin/charts/model-columns.tsx` — new, absorbing `model-delta.tsx`. `compare`
  true is the this-range-against-last grouped chart; false is one bar per model, which is the
  share view's second form.
- `components/admin/charts/model-legend.tsx` — new. The swatch/label/share list the mix and
  share views both drew.
- `components/admin/charts/{model-share,spend-heatmap}.tsx` — bodies now, without their own
  card, title or caption. `spend-heatmap` also exports `heatGrid()` and `pad()` so the panel can
  build the peak sentence without rendering the grid.
- **Deleted:** `trend-lines.tsx`, `model-mix.tsx`, `model-delta.tsx`. Their chrome is `plot.tsx`
  and their marks are its exports.
- `components/admin/cost-panel.tsx` — the range control moved into the panel's control strip;
  the seven graphics became `<ChartPanel>` + the always-on `<ModelTable>`. Two loading
  skeletons, not seven.
- `components/admin/charts/charts.module.css` — `.controls`, `.control`, `.controlLabel` for the
  strip; `.areaFill`, `.column`, `.seriesLine` and `.stroke1/2/3/Other` for the new forms.
  `.strokeOther` is dashed on purpose: as a line, the residual series has only `--text-muted`
  available, which is ΔE 0.3 from `--series-3` under deuteranopia, so the dash is what separates
  it. `.legend` lost the `flex: 1 1 220px` that was a 220px *height* in a column flex card.
- `components/admin/charts/series.ts` — `STROKE_CLASS` and `ARC_CLASS` alongside the fill map,
  so the four places a model becomes a colour all read from one file.
- `messages/{en,tr}.json` — 12 keys (`view`, `type`, ten `type*` labels). `mixCaption` and
  `modelsNote` were rewritten: both described a layout that no longer exists, and `mixCaption`
  said "the bands are stacked" under a drawing that can now be lines.
- `DESIGN.md` §W11 — the `Filters` row said "above the data", which is no longer where they are;
  the Cost charts block described seven stacked graphics. Five new rows carry the panel's rules.
- `charts/cost-charts.test.tsx` — rewritten to 22 cases against the panel, driving both selects.

**Verified**

- `npm test` — 124 files / 1310 tests. `npm run typecheck` clean. eslint clean.
- Read in the browser against the seeded stack, every view and every drawing. The Costs section
  went from 4451px to 2345px. Three things were fixed there rather than in review: the
  `mixCaption` wording above, the plot leaving a third of the card empty, and — the real one —
  **the empty-state line had gone missing on three views.** It used to live inside each deleted
  chart card; the panel now owns it, and the test asserts `toBe(1)` per view so it can neither
  vanish again nor be printed twice.

**Not done here (see ADR-ADD09 "Skipped"):** no URL or storage persistence for the chosen view,
no hover layer, and the plot is still a fixed-width SVG rather than a measured one.

## 2026-08-12 — comparing series: the endpoint stopped folding, and the charts learned six slots

The console could draw spend by model, but never *two named things against each other*. Worse,
`/admin/costs` folded everything past the top three into one `Other` row before the response left
the server, so `google:gemini-2.5-flash` and `openai:gpt-4.1-nano` — two of the five models the
platform actually calls — were unreachable by any chart or table. See `DECISIONS.md` ADR-ADD10.

**Backend**

- `backend/modules/admin/costs.ts` — `foldModels` → `rankModels`, returning `{ models, truncated }`.
  Every `(provider, model)` in the window comes back, ranked by cost with the same deterministic
  tie-break; there is no `Other` row and `provider`/`model` are never null. `MODEL_SERIES_LIMIT = 3`
  → `MODEL_CAP = 24`, a hard cap rather than a fold point, with `truncated` reporting exactly how
  many were dropped. A model that spent only in the *previous* window is seeded with zeroed current
  figures so it still appears — a model that just stopped being used is the fact an operator is
  looking for, not one to drop.
- Each model's `daily` went from `string[]` to `{ costUsd, calls, tokens, latencyMs }`, all dense
  and index-aligned to `buckets`. Every one of those already came out of query 1; the accumulator
  now carries all four instead of discarding three. **No new query, no schema change, no new index.**
- `backend/modules/admin/costs.test.ts` — `rankModels` covered in 9 cases (16 in the file):
  no fold, no nulls, the tie-break, the previous-window-only model, dense zero-filled arrays,
  daily latency rounding and its divide-by-zero guard, the cap and its count, and the money
  invariant asserted three ways.

**Frontend**

- `components/admin/charts/fold.ts` + `fold.test.ts` — new, and the reason the server could stop
  deciding. `foldTop()` rebuilds the three-plus-Other view at render time; `byProvider()` rolls
  models up into providers. 14 tests: every sum goes through `microUsd` integer micro-dollars,
  the platform total survives both operations exactly, daily series add index by index, and
  latency is weighted by calls rather than averaging averages.
- `components/admin/charts/series.ts` — `seriesStyle(index)` gives slots 0–2 the three hues solid
  and 3–5 the same three dashed. `FILL_CLASS` joins the stroke and arc maps.
- `components/admin/charts/series-picker.tsx` — new. Toggle chips, six-cap, disabled past it.
  Each chip carries a 16×2 line swatch in its own colour and stroke, so the picker **is** the
  legend rather than needing one beside it.
- `components/admin/charts/plot.tsx` — `Plot` takes a `format` prop (it hardcoded four-decimal
  dollars, and calls/tokens/latency are not money). `MultiLineMarks` takes `SeriesStyle[]` and an
  optional `filled`, which is the area form.
- `components/admin/charts/chart-panel.tsx` — the `compare` view, its `By` and `Measure` selects,
  and the folding that used to happen on the server. Switching dimension resets the selection;
  nothing is stored in an effect.
- `components/admin/charts/{model-legend,model-share,model-columns}.tsx` — take `models` and the
  figure they need rather than the whole response, since the panel now decides what they see.
- `components/admin/charts/model-table.tsx` — reads `daily.costUsd`, and now lists **every** model.
- `messages/{en,tr}.json` — 15 keys. `tokenlessNote` is the one that matters.
- `DESIGN.md` §W11 — the palette rule split into filled marks (three, then Other) and stroked
  marks (three, then dashed), plus five new rows for the compare view.
- `lib/query.ts` — `AdminCostDaily`, `truncated`.

**Verified**

- `npm test` — 126 files / 1358 tests. `npm run typecheck` clean. eslint clean.
- Read in the browser against the seeded stack across both dimensions and all four measures.
  Confirmed the two previously-hidden models are now selectable and draw.
- **One real defect found there and fixed:** `.scroller` carries `overflow-x: auto`, which
  zeroes a flex item's automatic minimum size, so the nested flex columns of the shell compressed
  it to 106px and clipped a 260px plot. It only became visible once the picker and its note added
  enough content to the card. `flex: none` on `.scroller` — the plot is sized by its own SVG and
  should never have been a shrink target. Also gave the selected chip the sunken bed the range
  buttons already use; border colour alone was too quiet a "this one is drawn".

  Two more the test pass caught before merge: the unfolded table was still asking `seriesToken`
  for a colour past the third row and getting `sOther` back — the same grey the legend uses to
  *mean* "the remaining models", so two named models were being labelled as the residual. Rows
  past the third now carry no swatch at all; absence is unambiguous where a grey box was not.
  And `truncatedNote` only rendered under the compare view, while the **table** is the surface
  that claims to be the whole ranked list and prints the platform total in its footer — with a
  real capped response its rows and its total would not have reconciled, and nothing nearby
  would have said why.

**Not done here (see ADR-ADD10 "Skipped"):** no small multiples past six series, no persistence of
the picked series, and overlapping filled areas still muddy past three.

## 2026-08-12 — the vitest integration ring stopped writing to the application database

Four owner items landed on one branch; this is the first. See `DECISIONS.md` ADR-ADD11 for why.

**Root cause, stated plainly:** `npm run test:integration` resolved `DATABASE_URL` from the repo-root
`.env`, which names `db:5432/interviewly` — the database `docker compose up` seeds and the app
serves. Six of the eight `*.integration.test.ts` headers instructed the developer to export that
same database by name, and Redis logical db 0 with it. Three of those files clean up nothing. The
acceptance ring was fixed for exactly this (#170, #119); the vitest ring never was.

- `package.json` — `test:integration` now resolves `DATABASE_URL`/`REDIS_URL` itself, ahead of
  `--env-file-if-exists`, with cucumber.js's precedence (`TEST_*` → exported → disposable localhost
  default). Also forces `NODE_ENV=test` (moves the report queue to the `acceptance` BullMQ prefix,
  off the one a running production worker consumes) and `LOG_TRANSPORT=stdout`.
- `vitest.global-setup.mts` — new. `assertDisposableStores()`, then `prisma migrate deploy` into the
  test database, then upserts the two reference personas (`seed-persona-hr`, `seed-persona-tech`,
  `avatar_set: {}`) that `seededPersona` looks up. Without those last two,
  `conductor.integration.test.ts` fails 15 tests — it was reading the production seed.
- `vitest.config.mts` — root-level `globalSetup`, gated on `INTEGRATION=1` so the default ring is
  untouched. One run for `node` and `worker` both.
- `backend/features/fixtures/disposable-stores.ts` — refusal message generalised; it named
  acceptance's TRUNCATEs to someone running vitest. Test regex updated with it.
- `.github/workflows/ci.yml` — the acceptance job's `REDIS_URL` gains an explicit `/1`. This ring
  refuses db 0 rather than rewriting it, and CI exported a pathless URL.
- `AGENTS.md` — the "`test:integration` cannot run on the host as-is" paragraph is no longer true
  and now describes the resolution and the refusal.
- `{state,answers,conductor,stats}.integration.test.ts`, `worker/src/{consumer,failure,jobs/abandon-sweep}.integration.test.ts`
  — deleted the `export DATABASE_URL=…interviewly` / `export REDIS_URL=…6380` lines. They are the
  proximate cause and they are now redundant.

**Verified**

- `npm run test:integration` — runs on a laptop for the first time, against `interviewly_test`:
  8 files, 43 tests. Observed the refusal fire against `.env`'s `interviewly` before the script
  change; observed `shutdown.integration.test.ts` hang on `LOG_TRANSPORT=elastic` and pass on
  `stdout`.
- `disposable-stores.test.ts` — 12 tests pass.

## 2026-08-12 — one follow-up per question

`DECISIONS.md` ADR-ADD12. The cap already existed; it was set to 4 (three follow-ups per question)
and the hint disagreed with the enforcement by one turn, so a model that ignored the allowed-actions
list got a free extra probe and the candidate then ate the forced advance.

- `backend/src/lib/env.ts`, `.env`, `.env.example` — `CONDUCTOR_MAX_TURNS_PER_QUESTION` 4 → 3.
  Twelve candidate utterances for a six-question interview instead of twenty-four. The adjacent
  comments described the old arithmetic and were rewritten.
- `packages/ai/src/prompt-vars.ts` — `mayProbe(turnsLeftOnQuestion)`, one predicate, `> 1`.
  `allowedActions` calls it; exported from `packages/ai/src/index.ts`.
- `backend/modules/interview/conductor.ts` — `clampAction`'s drift guard calls `mayProbe` instead
  of its own `<= 0`. The hint and the check are now the same decision.
- `backend/modules/interview/conductor.test.ts` — the drift tests retargeted, plus a new one that
  loops 3/2/1/0 and asserts `allowedActions`' offer of `continue` equals what `clampAction`
  honours.
- `backend/src/lib/env-wiring.test.ts` — the pinned default is 3.
- `backend/modules/interview/conductor.integration.test.ts` — two tests spent more turns on one
  question than the budget allows and then failed the advance CAS on their own stale interview
  snapshot. C01 builds its answer over two utterances; the T03 silence loop runs `MAX - 1`, which
  is where the drift fires for any value of the knob.

Deliberately **no** wall-clock cut for text interviews — see the ADR. The ask is that an interview
finishes inside twenty minutes; a timer makes it stop instead.

## 2026-08-12 — the interview is anchored in the job listing

`DECISIONS.md` ADR-ADD13. Two prompt versions, no code change: `live-client.ts` pins no version and
`registry.resolve()` serves the highest, so both go live on deploy while `llm_calls.prompt_version`
keeps past turns attributable (K9 — v1–v3 and v1–v4 untouched).

- `packages/ai/prompts/interview.question.generate.v4.prompt.yaml` — new. The six-line
  "ground the questions in the CV, name a specific thing from it" paragraph is replaced by a
  listing-anchor paragraph and a CV-is-background-only paragraph that forbids the "tell me about
  `<project>` on your CV" shape. `<job_listing>` moved to the top of the user message. Reply
  contract, injection paragraph, count/language rules and placeholder set unchanged.
- `packages/ai/prompts/interview.conduct.turn.v5.prompt.yaml` — new. v4 verbatim plus the section
  that had never existed in any version: what `<job_listing>` and `<candidate_cv>` are for, and
  that the CV is never the subject of a question. Its probing budget also restated to match
  ADR-ADD12 — v4's "at zero the server advances" was made false by that change.
- `packages/ai/src/prompt-builder.test.ts` — new test pinning the anchoring, since nothing in the
  suite asserted question content and nothing would have caught a quiet revert.

Not done: `interview.report.generate` still never receives the listing (it grades against the CV),
and `interview.question.candidates` sees neither. Both are named in the ADR with why.

## 2026-08-12 — job listings captured on landing

`DECISIONS.md` ADR-ADD14. The extension has always put `prefill`, `jobTitle`, `jobCompany` and
`jobId` on the URL; three of the four were read by nothing.

**Backend**

- `backend/prisma/schema.prisma` — `model JobListing` (cuid id, `user_id`, `external_job_id`,
  `job_title`, `job_company`, `job_text`, `created_at`, FK `onDelete: Restrict`,
  `@@unique([user_id, external_job_id])`, `@@map("job_listings")`), plus the `job_listings`
  back-relation on `User`. A new table is an exception to the schema header's nullable-columns rule
  and the ADR records why: a landing is not an interview and most landings never become one.
- `backend/prisma/migrations/20260812150000_job_listings/migration.sql` — hand-written to match
  what `prisma migrate diff --from-empty` emits, so CI's drift check has nothing to report.
- `backend/modules/interview/job-listing.ts` — new. `captureJobListing`: zod, all four fields
  required non-empty, `job_text` capped at `MAX_BLOCK_CHARS` (12 000) and labels at 300, upsert on
  the unique pair, `JOB_LISTING_CAPTURED`, 204.
- `backend/modules/interview/rate-limit.ts` — `jobListingLimiter`, 60/hour per user, no admin
  bypass.
- `backend/modules/interview/router.ts` — `POST /interviews/job-listings`. Inherits `requireAuth`
  and `requirePublicOrigin` from the router, which is what that router's comment asks of a new
  route.
- `backend/modules/interview/job-listing.test.ts` — 14 tests with `src/lib/db` mocked: upsert
  shape, every field's rejection, truncation.

**Frontend**

- `interviews/new/page.tsx` — reads all four params; a ref-guarded `useEffect` fires the capture
  once per landing, after the auth gate resolves. Silent: no UI, no message keys, and a failure
  never touches the setup flow.
- `lib/query.ts` — `useCaptureJobListing`, shaped like `useCreateInterview`. Nothing reads the rows
  back, so no query key.
- `lib/auth-redirect.ts`, `lib/use-require-auth.ts` — `signInPathFor` carries the query string. It
  encoded only the pathname, so a signed-out extension landing lost the entire payload before
  sign-in — no capture and no prefill either. `safeReturnPath` was already correct and gained tests
  rather than edits.
- `page.test.tsx`, `auth-redirect.test.ts`, `use-require-auth.test.tsx` — all four params present
  posts once, a missing one posts nothing, a failed post does not break the page, and the query
  survives the sign-in round trip while `//evil…?q=` and `/\evil…?q=` stay refused.

**Verified (all four items on this branch, together)**

- `npm test` — 127 files / 1395 tests pass.
- `npm run test:integration` — 8 files / 43 tests pass, against `interviewly_test`.
- `npm run test:acceptance` — 111 scenarios / 885 steps; `cucumber-js -p auth` — 36 / 258.
- `npm run typecheck` and `npm run lint` — exit 0.

## 2026-08-12 — erasure reaches the captured listings, and the new prompts carry their K9 header

The two items the three entries above flagged, closed on the owner's instruction.

- `backend/modules/auth/delete-account.ts` — `tx.jobListing.deleteMany({ user_id })` inside the
  erasure transaction, beside `emailToken.deleteMany` and for the same reason: nothing references
  the rows, so there is no `RESTRICT` to route around and nothing to anonymise. A captured listing
  is a record of which vacancies the account browsed, with no operator ledger behind it, so it is
  removed rather than kept. The module's own bullet list of what erasure does now says so.
- `backend/tests/step-definitions/account-erasure.ts` — the fixture creates a `job_listings` row
  that outlives the interview beside it (a landing captures without creating an interview, so
  soft-deleting the interview does not reach it), and `no personal data remains` asserts the count
  is zero. Without both halves the scenario passed with the row still sitting there.
- `packages/ai/prompts/interview.question.generate.v4.prompt.yaml`,
  `packages/ai/prompts/interview.conduct.turn.v5.prompt.yaml` — the `# K9 versioned prompt` header
  every other prompt file carries, plus the per-revision note saying what changed and why. They
  shipped without it under this branch's no-new-comments constraint; the header is the file
  convention that teaches the next editor not to edit a shipped version in place, which is the one
  place in this tree where losing a comment loses a rule.

## 2026-08-12 — the report grades against the listing

`DECISIONS.md` ADR-ADD15. The last of the three items the entries above flagged. The interview
assessed fitness for the listed role; the report then graded the same transcript against the
candidate's CV, because `reportVars` had never been given the vacancy.

- `packages/ai/src/AiClient.ts` — `GenerateReportArgs.jobListing: string`, non-optional and
  non-nullable (`interviews.job_text` is NOT NULL, so no `NULL_MARKERS` entry).
- `packages/ai/src/prompt-vars.ts` — `reportVars` passes it through.
- `backend/modules/interview/report-run.ts` — `jobListing: interview.job_text`; the row is already
  loaded, so no extra query.
- `packages/ai/prompts/interview.report.generate.v6.prompt.yaml` — new (K9: same uuid, v1..v5 on
  disk untouched, no code change to go live). The listing is named as the standard the report
  grades against and joins the injection boundary; the 0..100 scale reads "as fitness for the role
  the listing describes"; v5's CV cross-check is kept but subordinated, with "never grade the
  candidate against their own resume" added and the `no cv provided` path now reasoning from the
  transcript **and** the listing. Reply contract, bands, `star_adherence`, stopped-early and
  integrity rules all untouched — exactly one placeholder added.
- `backend/features/step_definitions/profiling.steps.ts` — the field on the report args those
  scenarios build. `world.ts` needed nothing: its flattened vars already carry a realistic
  `jobListing` for the question prompt.
- `packages/ai/src/prompt-builder.test.ts` — new test asserting the live report prompt binds the
  listing and instructs grading against it. It resolves with no pinned version, so it also proves
  v6 is what ships.

**Verified (whole branch, again)**

- `npm test` — 127 files / 1396 tests.
- `npm run test:integration` — 8 files / 43 tests.
- `npm run test:acceptance` — 111 scenarios / 885 steps; `cucumber-js -p auth` — 258 steps.
- `npm run typecheck`, `npm run lint` — exit 0.

Left open, deliberately and now the only one: `interview.question.candidates` is anchored to
neither the listing nor the CV and overwrites question rows, but the path is dead today
(`promoteNextQuestion` returns early for every interview). ADR-ADD15 says who owns it.


## 2026-08-12 — adaptive questioning fires for the first time

`DECISIONS.md` ADR-ADD16. Found by running an interview end to end and reading the logs.

- `packages/ai/src/providers.ts` — gemini gets `thinkingConfig: { thinkingBudget: 0 }`. Thinking
  was charged against `maxOutputTokens`, truncating the whole fallback tier, not only this prompt.
- `packages/ai/prompts/interview.question.candidates.v3.prompt.yaml` — new. Object reply contract
  (`json_object` cannot emit an array, so v1/v2 failed every call) and the listing bound as the
  anchor. v1/v2 untouched, same uuid.
- `packages/ai/src/schemas.ts`, `index.ts`, `live-client.ts` — `CandidateBatchSchema`;
  `generateCandidates` unwraps `.candidates` and still returns `Candidate[]`.
- `packages/ai/src/AiClient.ts`, `prompt-vars.ts`, `backend/…/candidate-prep.ts` (+ selftest) —
  `jobListing` through to `interview.job_text`.
- `packages/ai/src/providers.test.ts`, `prompt-builder.test.ts` — the transports' first
  request-body tests, plus the prompt's contract and anchor.

**Verified:** 5/5 promotions on a six-question run, difficulty matching the selector's table
including the clamp, no fallbacks. `npm test` 127 files / 1400. `@adaptive-questions` 7 / 53.
Selftests, typecheck, lint clean.

**Not done:** the conductor overwrites the promoted `text` but keeps the promoted `topic`.

## 2026-08-12 — the stack measured at 1, 2 and 4 api replicas

Scaling, latency and performance, run locally against `docker compose --scale api=N`. Decisions
and their reasons are ADR-ADD17; this is what changed, what was run, and what came back.

**Made scalable**

- `Caddyfile` — `reverse_proxy api:4000` became `reverse_proxy { dynamic a { name api; port 4000;
  refresh 5s } lb_policy round_robin }`, same for `web:3000` and the webhook block. A named
  upstream resolves once into a keep-alive pool, so a second replica sat idle; a dynamic upstream
  set re-reads the A record every 5s and spreads per request. Measured 25.0 % / 25.0 % / 25.0 % /
  25.0 % across four replicas (max spread across every run: 1.0 percentage point, at 2 replicas).
- `compose.scale.yaml` — new overlay. Publishes db and cache (the harness reads
  `pg_stat_database` and `INFO clients`), leaves `api` unpublished so `--scale api=N` can start a
  second one at all, and forces `AI_ENABLED=false`, `LOG_TRANSPORT=stdout` and
  `connection_limit=${SCALE_DB_POOL:-10}` on the database URL.
- `backend/src/lib/profiler.ts` + `backend/modules/admin/perf.ts` — new. Per-route-pattern
  latency rings (4096 samples), status classes, event-loop delay, CPU and RSS per window;
  `X-Instance` (8 hex of sha256 of the hostname) on every response; `GET /admin/perf` and
  `POST /admin/perf/reset` on the admin router. `backend/src/app.ts` mounts the middleware first,
  ahead of the body parser. Four unit tests in `profiler.test.ts`.
- `loadtest/` — new. `lib.mjs` (scenarios, closed-loop generator, percentiles, docker/psql/redis
  readers), `scale.mjs` (the run), `report.mjs` (JSON to PDF via the `pdfkit` the worker already
  depends on), `README.md`, and `results/` with the two runs below.

**The run** — 6 scenarios x {8, 64} connections x {1, 2, 4} replicas, 12 s measured after 3 s of
discarded warm-up, 36 cells, on Docker Desktop 29.4.0 with 8 CPUs and 7.75 GiB. Every cell's
evidence is in `loadtest/results/compose-scale.json`; `loadtest/report.pdf` is rendered from it
and quotes nothing else.

Throughput at 64 connections, 1 replica to 4:

| scenario | 1x | 2x | 4x | factor |
|---|---|---|---|---|
| `healthz` | 6400 | 5974 | 7462 | 1.17 |
| `readyz` | 4698 | 3685 | 4437 | 0.94 |
| `me` | 1129 | 1247 | 1518 | 1.34 |
| `me/interviews` | 400 | 535 | 524 | 1.31 |
| `interviews/:id/state` | 144 | 248 | 324 | 2.24 |
| `web-home` (control) | 128 | 128 | 117 | 0.92 |

**What the numbers say, and the observation behind each**

- **The heavier the endpoint, the better it scales.** `interviews/:id/state` — the only scenario
  whose one-replica p95 was already over half a second — is the one that gained 2.24x. Its
  event-loop delay p99 fell from 91.55 ms at one replica to 32.01 ms at four: the queue moved off
  a single loop, which is exactly what a replica is for.
- **The cheap endpoints are bound by something that is not the api.** At one replica serving
  `healthz` at 6400 rps, the api container drew 112 % CPU and the *edge* drew 125 %; server-side
  p95 was 0.19 ms while the client saw 16.32 ms. 16.1 of those 16.3 ms are outside the API
  process. Scaling api cannot move a number the api does not own.
- **The host is the ceiling, and it is reached at one replica.** A single api container measured
  572.7 % CPU during `me/interviews` and 572.5 % during `interviews/:id/state` on an 8-core VM
  (Prisma's query engine is not on the JS thread). Four replicas therefore share the same eight
  cores that one replica had already half-filled — which is why the factors land between 1.2 and
  2.2 rather than near 4.
- **The control behaved as a control.** `web-home` never touches the api: 128 → 128 → 117 rps,
  api CPU 0.3 % → 5.9 %. Scaling api did not move it, which is the evidence that the other
  movements are attributable to the replicas rather than to the day.
- **The pinned pool is what made 4 replicas legal.** Postgres connections went 12 → 22 → 42,
  exactly the base plus 10 per api process. Prisma's default here would be 17 per process
  (`2 x 8 + 1`): four api replicas plus the worker would ask for 85 against `max_connections =
  100` before a single interview ran. Redis clients tracked 9 → 11 → 15.
- **Nothing fell over.** 36 cells, 0 transport failures, every response 2xx.

**Repeatability, because one run per cell is not a measurement of variance**
`loadtest/results/compose-repeatability.json` re-ran two cells three times at one replica:
`healthz` c=64 gave 6004.8, 3784.3 and 6112.1 rps (a 38 % spread, one outlier where the host was
busy), `interviews/:id/state` gave 168.7, 150.3 and 159.9 rps (±6 %). Read the table above with
that in mind: the 2.24x on `interview-state` is far outside that noise, the 1.17x on `healthz`
is not.

**Two harness defects found by running it**

- `POST /admin/perf/reset` reached "3 of 4 replicas" and aborted a 4-replica pass. The round robin
  is per request and the load traffic advances it, so N x 4 probes can miss a replica by chance
  (~4 % at N=4). Now N x 12 + 8 probes, and the run still refuses to proceed if one is unreached —
  the check was right, the budget was not.
- That abort lost 24 completed cells, because the JSON was only written at the end. `scale.mjs`
  now writes the file after every cell.

**Not measured here, and deliberately:** live SSE rooms and the per-stream `redis.duplicate()`
ceiling (`sse.ts:180`) — the `platform` ledger's P03/P04 own that scenario; any write path, all of
which are rate-limited by design; and the profiler's own overhead, which is inside every number
above rather than isolated from it.

**Verified:** `npm test` 128 files / 1400 tests; `npm run typecheck` and `npm run lint` exit 0;
`caddy validate` on the new Caddyfile; the edge reached 1, 2 and 4 distinct instances at the three
scale steps, recorded per step in the results file.

## 2026-08-12 — the room was recording the interviewer, and the credit downgrade was half-wired

Two owner reports in one session, plus the latency work that came with them. Seven subagents in
parallel; the split was by file, so nothing collided except one comment that ended up attached to
the wrong function and was moved back by hand.

**The capture bug (ADR-ADD19).** Reproduced before it was diagnosed: a probe stop re-opens the mic,
the upload hangs, the conductor's reply arrives on the refetch, and the speak effect plays TTS into
a recorder nobody closed. Then the effect opened a second recorder over the first without stopping
it, and the orphan's chunks — read against `chunksRef.current` at delivery time — landed in the
*next* turn's upload. Two failing tests first, both red for the right reason: the recorder was still
`recording` when playback began, and the uploaded file contained the orphan's bytes. `recorderRef`
identity now decides which recorder owns a turn; `discardRef` is deleted, because a single boolean
cannot name which of two recorders is being thrown away.

**The downgrade (ADR-ADD18).** `tts.ts` downgraded on a fatal provider error, `stt.ts` did not, and
nothing in the acceptance suite drove the STT route. The candidate's own answer was therefore the
one path where running out of credits stranded them in a voice room with no composer, while being
told they were in a text one. Fixed in the shared `transcribeRecording`, awaited so the mode is
durable before the 503 goes out — a floated call re-opens the exact race, and the test says so.
Around it: ElevenLabs no longer retries a 401 three times, the "continuing in text" notice survives
the mode flip that used to unmount it, the mic is released when the room stops being a voice room,
and the downgrade publishes its SSE.

**Latency, and one thing found while looking for it.** `L03`'s window went 2 000 → 1 000. The
conductor's four independent per-turn reads now issue as one `Promise.all` — the audit of every
write between them is in the task notes; `loadConversation` is the one genuinely ordered read and it
still precedes both inserts. The model price table was being read off disk, YAML-parsed and
zod-validated before **every** LLM call; it is now loaded once per process.

The thing found by accident: `logAiCall` was writing ~94 kB per conductor call at `info`, carrying
the rendered prompt — which is the candidate's CV, their profile and the whole transcript — into
stdout and from there into Elasticsearch. `logger.ts`'s own header forbids it in as many words:
"No secrets, PII, tokens, or PDF content in any log call." Unconditional, so relevelling it to
`debug` would not have satisfied it. Content is now a length and a hash; every operational field
survives.

**Persona memoization was proposed and refused.** `generation.ts` documents it as already tried and
reverted: `active` is how a persona is retired, and a process-lifetime cache keeps a retired persona
conducting interviews until every api and worker restarts. `persona-for.test.ts` exists because that
table served the wrong persona in production once.

**Not done, and both need a microphone:** `L02`'s and `L03`'s before/after medians, and speaking to
the shortened window to confirm it does not interrupt. **And a caveat that touches every number in
`speech-latency` and `turn-taking`:** the gate-accuracy data those ledgers quote was gathered in the
room that was recording the interviewer. It has not been re-taken.

**Verified:** `npm test` 129 files / 1422 tests; `npm run -w frontend test` 61 files / 727 tests;
root lint, frontend lint and typecheck all clean. The acceptance suite was NOT run — `compose.yaml`
does not publish the store ports and `compose.dev.yaml` was not loaded — so the new
`@speech-fallback` scenario is dry-run-verified only (steps all resolve, zero undefined under
`strict: true`) and is owed a real run.

## 2026-08-12 — the admin console was describing speech calls it had no record of

Owner's report was the `v0` badge. That was the least of it, and the cheapest to fix.

Started from the database rather than the code, which is what made the ranking obvious: twelve
recent `llm_calls` rows showed `model: 'tts'`, `latency_ms: 0`, `prompt_uuid: ''` on every
ElevenLabs row. So `v0` was a render bug over a correct encoding, while `model` and `latency_ms`
were stored wrong — and `latency_ms: 0` was a hardcoded literal in `metering.ts`, which meant the
provider-latency panel and the daily cost/latency series had been reporting the product's slowest
call as instantaneous the whole time.

The fix that mattered was a seam, not a patch: `speak`/`transcribe` now return the provider and
model that actually served the call, so the row records what happened instead of what the call site
assumed. Timing stayed at the call site on purpose — the retry loop is inside the driver, so a
caller-side stopwatch spans all three attempts, and a provider-reported duration would have forced
the fake to make one up.

Two things fell out of that seam. The fake had been reporting `elevenlabs` and getting priced at
live rates, so every stub-mode and acceptance row carried invented spend; it now bills nothing.
But three acceptance scenarios exist precisely to prove that a provider call *does* bill
`spent_usd`, and an honest fake would have turned them into tautologies that pass while asserting
nothing — the same trap as the `tts.test.ts` mock that was set up and never asserted on. So the
fake now takes the identity it stands in for as a constructor argument and the `@speech` hook
declares it. The impersonation lives in the test that wants it.

Also found while in there: STT was billing zero seconds when Scribe returned no word timings —
free transcription the provider still charged for — and TTS was counting characters as UTF-16 code
units, so emoji counted twice.

**Verified:** `npm test` 130 files / 1432 tests; `npm run -w frontend test` 62 files / 729 tests
(the admin call table had no test file at all before this; it has one now, covering a speech-shaped
row and an LLM-shaped one); lint and typecheck clean.

**Not run: the acceptance ring.** It needs `compose.dev.yaml`'s published store ports — Redis on
6380 refused the connection — and it writes into the dev database rather than a scratch one. The
three `@speech` S04 scenarios and the new `@speech-fallback` STT scenario are dry-run-verified only
and are owed a real run: `docker compose -f compose.yaml -f compose.dev.yaml up -d db cache`, then
`npm run test:acceptance -- --tags '@speech'`.

**Not done:** no backfill of the existing rows. `model` straddles L01's TTS swap with no record of
which row used which, and `latency_ms` was never captured — see ADR-ADD20.

## 2026-08-12 — an interview that ended itself at question 2 of 6, and the audit log that mostly
watched itself

Two unrelated bugs, found from one real interview's logs and one audit-log tally. See
`DECISIONS.md` ADR-ADD21 and ADR-ADD22 for the reasoning; this is what changed and where.

**The completion guard (ADR-ADD21)**

- `backend/modules/interview/conductor.ts` — new `mayComplete(interview)`
  (`target_question_count - current_index === 0`), added to `__testing`. `clampAction` refuses
  `end_interview` with `endReason: 'completed'` when it is false (new `RefusalReason`
  `questions_left`, with its own `REFUSAL_NOTE` entry), and separately validates `turn.endReason`
  against the `END_REASONS` map via `isEndReason` rather than falling back to `cut_short` on any
  truthy string. `mayEnd` is untouched — both guards run, in order, for every `end_interview`.
- `backend/modules/interview/conductor.ts` — `askConductor` now binds `questionsLeft:
  questionsLeft(interview)` into `ConductTurnArgs`, the same helper `mayComplete` reads.
- `packages/ai/prompts/interview.conduct.turn.v6.prompt.yaml` — new (K9: v1–v5 untouched). Binds
  `questionsLeft` and restates `completed` as the end of the interview, with a round out of its own
  topics named as the handover it always was.
- `backend/modules/interview/conductor.test.ts` — `mayComplete` on its own, plus `clampAction`
  cases: refused mid-interview with `questions_left`, allowed on the last question, `cut_short`
  still allowed anywhere with questions left, an unrecognised `endReason` refused as `no_reason`.
- `backend/modules/interview/conductor.integration.test.ts` — a `completed` request at question 2
  of 4 refused end-to-end (no `ended_reason`, no report, the transcript shows `continue`); the
  identical reply honoured once the interview has actually run out of questions; abuse still cuts
  an interview short with questions left. The pre-existing "closing answer survives every exit"
  (AC-11) case moved from ending on `completed` to ending on `cut_short` — it seeds an interview at
  question 2, and a `completed` ending there is exactly the bug this closes.

**The injection scanner's false positives (ADR-ADD22)**

- `packages/ai/src/prompt-builder.ts` — `SERVER_OWNED_FIELDS = new Set(['allowedActions'])`,
  skipped before `scanForInjection` runs any pattern against a bound value. Landed alongside an
  unrelated commit on this branch (`3eac4e2`); recorded here because nothing else names it.
- `packages/ai/src/prompt-vars.ts` — `formatConversation`'s system-row label changed from
  `SYSTEM:` to `NOTE:`. `role-marker-injection` compiles with the `im` flags and matches a role
  marker at the start of any line, not only the compiled message's start, so the label was
  self-matching on every silence or refusal note in a transcript.
- `packages/ai/src/prompt-builder.test.ts` — a bound `allowedActions` naming `end_interview` and
  `handover` produces zero `SECURITY_PROMPT_INJECTION_SUSPECTED` events; the same word arriving
  through `jobListing` still produces one, attributed to that field and to `action-name-injection`.
- `packages/ai/src/prompt-vars.test.ts` — new `formatConversation` block: a conversation carrying
  two system notes renders `NOTE:` on both and matches neither `role-marker-injection` nor
  `forged-turn-sequence`; a candidate utterance that opens a line with `SYSTEM:` itself still
  matches `role-marker-injection`, pinning that the fix narrows the false positive without
  narrowing the real one.

**Verified:** `npm run typecheck` and `npm run lint` — clean. Unit suite 1443 passing across 130
files. The integration ring was run against a throwaway Postgres and Redis rather than the
developer stack, whose stores compose publishes on no host port: `conductor.integration.test.ts`
19 passing, the whole `--project worker --project node` ring 45 passing.

**Not done:** neither `injection-patterns.yaml` pattern was touched — both false positives were in
what was fed to the scanner, not in what it looked for. See the ADR for why loosening either would
have been the wrong fix.
