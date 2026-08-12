# Additionals — decisions

Not a numbered-task ledger (per the owner: "no tasks, just devlogs and decisions"). One entry
per feature dropped in here directly, append-only like every other DECISIONS.md.

## ADR-ADD01 — `change_avatar` tool

**Ask:** a conductor tool the interviewer can call mid-turn to swap its own displayed
expression. 6 avatars total, 3 for Ada (HR), 3 for Turing (technical). Example: a standard
question may carry `change_avatar id:1`; if the persona is already showing avatar 1, nothing
happens; otherwise the new avatar is pushed so the candidate sees it live, mid-interview.

**Shape chosen:**

- **Not a provider-native tool call.** `ConductorTurnSchema` (`packages/ai/src/schemas.ts`) is
  already the whole tool-calling surface for this codebase (see its own doc comment) — `say` /
  `action` / `question` / `endReason` / `widget` are all one JSON object the model returns, re-
  validated server-side. `avatar: 1|2|3` is one more optional field on that same object, not a
  second call-and-validate path.
- **Per-persona ids, 1..3, not a global 1..6.** The tool only ever addresses "the persona
  currently speaking" — the room shows one live tile — so there is never a need to say *which*
  persona's avatar 1 is meant. Ada's 1..3 and Turing's 1..3 are two independent sets, keyed by
  `personaId` in storage. Matches the example in the ask exactly (`id:1`, not `ada-1`).
- **Redis, not Postgres, for "what's live now".** This is presentation state, read by exactly
  one thing (the room's live tile) and nothing about an interview is incorrect if it is lost —
  no report, score, or transcript field ever reads it. A DB column and migration would be the
  heavier tool for a fact with a 24h shelf life. Reused the existing shared `redis` client
  (`modules/auth/rate-limit.ts`) that `sse.ts` already publishes through — no second client.
- **SSE nudge, not payload.** `use-interview-events.ts`'s contract is explicit: the event says
  *that* something changed, the client always refetches `/state` for *what*. `avatar.ts` follows
  it exactly — one more event name (`INTERVIEW_AVATAR_CHANGED`) added to the same channel, same
  swallow-own-failure shape as `publishQuestionsReady`.
- **Prompt bumped to v3, not edited in place.** K9's rule (registry.ts): a shipped prompt
  version is immutable because `llm_calls.prompt_version` is a permanent record of what a past
  turn was conducted under. v1/v2 are untouched; v3 adds one short "YOUR EXPRESSION" section and
  the `avatar` field to the reply-JSON template.
- **Where the id lives in the JSON reply:** `avatar` rides alongside `action` on the *same*
  turn, not as a separate call. An interviewer's expression changes independently of whether it
  is continuing, advancing, or handing over — tying it to `action` would mean an expression
  change forces `action` to a value that means something else. Optional and silently ignored
  out of range, same posture as `widget`: a bad expression request is not worth refusing a turn
  over, unlike `end_interview` or `handover` which are refused loudly because getting those
  wrong is a security/consistency problem, not a cosmetic one.

**Skipped, deliberately:**

- **No `persona-tiles.tsx` wiring.** `frontend/src/components/avatar.tsx` (`Avatar`, `avatarUrl`)
  already exists for a *different* axis — `AvatarState` (idle/listening/thinking/speaking/
  acknowledging), 5 values, driven by room lifecycle phase — and is not even wired into
  `persona-tiles.tsx` today (that component only renders CSS wave bars, no `<img>`, and
  `room/page.tsx` says so explicitly: "the tiles draw the speaker as CSS bars, so nothing here
  requests an avatar object", issue 126 — a deliberate choice, not an oversight). Building the
  expression tile is a real frontend task with its own token-lint/i18n/CSS-module constraints
  and belongs to whoever owns `frontend`/`interview-core` per `.agents/EXECUTE.md` — out of
  scope for a same-session drop-in, and reversing issue 126's decision is not this ADR's call to
  make. What ships here: the backend accepts the tool call, caches the result, seeds real
  artwork at the keys a future tile would read, and nudges the room over SSE with
  `persona.avatar` (1..3) in `GET /state`'s payload.
- **No admin/seed tooling for uploading more images later.** The seed script is the only writer
  today (three real photos per persona, see the 2026-08-11 devlog entry); a re-upload path is
  worth building once there is a second source of images.

**Upgrade path:** when the room grows an expression tile, it reads `persona.avatar` from
`GET /interviews/:id/state` (already shipped) and resolves it against whatever storage-key
scheme is added to `avatar_set`.

## ADR-ADD02 — the expression tile and the self-camera

**Ask (owner, 2026-08-11):** ADR-ADD01's backend shipped without a face — the room never drew
the expressions `change_avatar` was setting. And the candidate could neither try nor see their
own camera anywhere: not in pre-join, not in the room. Both, in the frontend.

**Shape chosen:**

- **`components/avatar.tsx` reused, not replaced.** It already did the whole job — content-
  addressed `<img>`, monogram fallback, the 1×1-placeholder size check — and had been dead since
  issue 126. Three changes: `AvatarSet` is keyed by `string` (the set holds `AvatarState` keys
  *and* `expr-n` ones), an `expression?: number` prop picks the artwork while `state` keeps
  labelling the tile, and the failure flag became the *key* that failed rather than a boolean —
  a boolean latched the first placeholder and rendered every later expression as the monogram.
- **The inline styles came out.** The monogram fallback was a `style={{…}}`, which the CSP drops
  in production — the component was exempted from `grounds.test.ts` only because nothing imported
  it. Now it has `avatar.module.css` and the exemption list is empty.
- **Only the speaker gets an expression.** `GET /state` resolves `persona.avatar` for the live
  persona alone (ADR-ADD01), so `PersonaTiles` takes one `activeExpression` and every other tile
  draws slot 1. An interviewer who is not talking has nothing to react to.
- **The camera is one component used twice** (`components/camera-view.tsx`), pre-join and the
  room's candidate tile. Off by default and toggled by the candidate, per the voice spec (§3.2):
  the stream is bound to a local `<video>`, is never recorded or uploaded, and is not exposed to
  the caller — there is no API by which a parent could get at it. Turning it off **unmounts the
  capture** rather than hiding it, which stops the tracks and puts the hardware light out.
- **Mount as the reset.** `CameraView` is a two-component split (`Capture` / `Frame`): the
  capture's whole lifecycle is its mount, so a refusal cannot still be on screen the next time the
  camera is switched on, and no state is written synchronously from an effect (the React lint
  forbids it, and it is the cascade it says it is).
- **The camera gates nothing.** Only the microphone decides whether pre-join's CTA is live —
  a blocked or missing camera is a sentence inside the frame and nothing else. Voice spec §3.2 and
  the error table both say a camera denial is not an error.

**Skipped, deliberately:**

- **No camera device picker.** The mic has one because switching input mid-interview is a real
  recovery path; a second webcam is not. Add it when someone asks.
- **The pre-join choice is not carried into the room.** Both surfaces start off, which is what
  "off by default" means; a remembered `on` would turn a camera on without a click on the screen
  it turns on in. `sessionStorage` if that ever reads as friction rather than as care.
- **No preload of the expression objects.** Issue 126 expired its hints unused; the tile requests
  one image per persona and the SSE nudge that follows a `change_avatar` is not a hot path.

**Supersedes:** ADR-ADD01's "no `persona-tiles.tsx` wiring", and W09/W10's mic-only reading of
the spec (`.agents/ledgers/frontend/STATE.md`) — the self-camera those rows named was always in
`.agents/specs/2026-07-29-voice.md` §3.2 and is now built.

## ADR-ADD03 — the listing screen, and the interview language as a tool

**Ask (owner, 2026-08-11):** nothing checked that the pasted job listing was a job listing.
Language was worse: the interview ran in the account's locale, the locale switch is hard to find,
and a candidate who changed language mid-interview was not followed. Plus two prompt complaints —
too many clarification questions, and "thank you for your answer" said back to `dsflk;dsjgds`.

**Shape chosen:**

- **One check, two answers.** `interview.listing.validate` (new K9 lineage, `gpt-4.1-nano`)
  returns `{is_job_listing, language}`. The listing is the only text an interview is built from,
  so the call that reads it for "is this real" is the same one that reads it for "what language
  is this" — a second call to classify the language would be a second bill for one paragraph.
- **The check runs after `interview.create`, not before.** `llm_calls.interview_id` is NOT NULL,
  so a pre-create call has nothing to hang its audit row on, and widening the column is a
  migration for an ordering problem. A refused listing soft-deletes the row it needed (every FK
  here is ON DELETE RESTRICT, and the audit row points at it) and answers `LISTING_NOT_A_JOB`
  before the daily quota is charged and before any question is generated.
- **Fail-open when the check is unreachable, fail-closed when it answers.** Refusing every
  interview because a screening model timed out trades a content check for an outage. A check
  that came back and said "not a listing" is honoured; a thrown one logs
  `LISTING_CHECK_UNAVAILABLE` and lets the interview through, where the §7.1 boundary and C07's
  patterns are still in force.
- **`set_interview_language` is a field on `ConductorTurnSchema`, like `avatar` (ADR-ADD01).**
  Same reasoning: that object already *is* this codebase's tool-calling surface. The interviewer
  reads the candidate's latest message and asks for the move by name; `conductor.ts` applies it
  before anything downstream generates or speaks, so `ensureTechBatch`, the K4 promotion and
  every ElevenLabs call read the new language rather than the one the candidate just left.
- **I10's heuristic streak stays.** The tool is the fast path (one message, the model's read);
  `trackLanguage` is the backstop for a turn the model did not act on. Both write through the
  same `SUPPORTED = {en, tr}` guard and the tool clears the streak, so they cannot double-count.
- **Prompt v4, not an edit of v3** (K9). Three changes: the language tool, a narrower
  clarification rule (once per question, and only for an answer that misses the question or
  claims a result with nothing behind it), and an unintelligible-answer rule — say plainly that
  you did not understand, never thank the candidate for text you could not read.

**Skipped, deliberately:**

- **No `reason` on the check's output.** The candidate is told the listing was not one; a
  model-written explanation of *why* is a second string to translate and a new place for listing
  text to leak into a response body.
- **No language in the TTS cache key.** `speech/<questionId>.mp3` could serve pre-switch audio
  for a question re-spoken after a move; the conductor speaks through `chat_messages`, whose keys
  are per message. Key it by language if a re-spoken question ever surfaces in the wrong one.
- **The account locale is untouched.** The interview follows the listing; the UI still follows
  the account. Making one write the other is a settings change nobody asked for.

## ADR-ADD04 — the score chart on the report, and what the PDF is allowed to name

**Ask (owner, 2026-08-12):** a visual chart of the candidate's performance on the report, the
chart and its parameters ours to pick; and the downloaded report file "exposes interview ID
directly, not a security bug but looks bad".

**Shape chosen:**

- **Per-answer scores, grouped by round — not a second reading of the overall score.** The
  payload holds three levels of number: one `overall_score`, two round scores, and one score per
  question. The first two are already single values against a ceiling and are already `Meter`s
  (DESIGN §5: "bars, not charts" — one value against one ceiling is a bar). The per-question
  series is the only thing on this surface a bar cannot say: a candidate who opened at 40 and
  closed at 90 and one who did the reverse own the same 65, and the report could not tell them
  apart. The chart is the shape of the interview, which is why it sits directly under the verdict
  sentence and above the rounds.
- **Hand-rolled SVG, not `recharts`.** The dependency is installed and unimported (same standing
  as ADR-W09's `<progress>`), and it stays that way: the production CSP is
  `style-src 'self' 'nonce-…'`, which drops the style attribute every chart library positions
  with. Every value here is geometry in an attribute — `x`, `y`, `width`, `height`,
  `stroke-dasharray` — the pattern `sparkPoints` (dashboard) already established. Colour comes
  from `--series-1`/`--series-3` through CSS module classes, so no hex reaches the `.tsx` the
  token lint scans.
- **Grouped by round, labelled in text under each group.** Colour distinguishes the two rounds
  and is deliberately redundant: the group's name is printed under it and each column prints its
  own score above it, so nothing on the chart is readable by hue or by length alone (§6). That
  also removed the legend — a key explaining two colours that are already labelled is a third
  copy of the same fact.
- **The chart is `aria-hidden`, with a `figcaption` that states the baseline.** Every number in
  it is already text in "Question by question" underneath. Announcing a third traversal of the
  same scores is noise, and the same reasoning `Meter decorative` already encodes.
- **Two answers minimum.** One column is not a trend, and a chart of one bar next to that
  question's own `Meter` is the same value drawn twice.
- **The PDF names the practice, not the row.** `Interview <cuid>` in the document header and in
  the PDF `Title` is replaced by the interview's `occupation` — the thing the candidate would
  call this run — and the id is gone from both. `finalizeReport` reads it through the `include`
  it already had a query for; the renderer stays pure and deterministic, which is what the
  byte-equality test protects.
- **The saved filename is set on the signed URL, not by renaming the object.** The key stays
  `reports/<interviewId>.pdf`: it is derived, idempotent under retry, and asserted in four test
  files. What the browser saves is a `ResponseContentDisposition` on the presign —
  `interviewly-report-<yyyy-mm-dd>.pdf` — so the id stops being the filename without the storage
  layer learning a second naming scheme. `signedUrl`'s third parameter is optional, so the CV
  upload path and every fake `Storage` are untouched.

**Skipped, deliberately:**

- **No STAR series on the chart.** It applies to HR questions only, so a second series would be
  drawn for half the columns and absent for the other half — a hole a reader reads as a zero.
- **No occupation in the filename.** It is free text from a pasted listing; sanitising it into a
  filename is more code than the date, and the date already separates one download from another.
- **The report page still does not know its own occupation.** `GET /interviews/:id` returns
  `{interviewId, state, report}`, and the PDF gets the role from the worker's own query. Threading
  it into the screen is a change to that endpoint, which nothing on the screen asked for.

## ADR-ADD05 — the landing page as the room, and a cast that reacts

**Ask (owner, 2026-08-12):** the homepage read as "AI slop" — half professional, half enjoyable,
and boring enough that a visitor left fast. Revise it completely, with illustrated Open Peeps-
style avatars and real motion rather than a slide or a component swap, without drifting from the
design language.

**Shape chosen:**

- **The page is the room, not a page about one.** The retired arrangement was a tall hero band, a
  boxed `<DemoInterview>` under it, and six documentary bands. The demo was the strongest thing
  on the surface and it was in a box, three-quarters of a viewport below the fold. Now the first
  viewport *is* the dark act: `--rail` full-bleed, headline and the page's single `--primary` on
  the left, the job listing as a lit `--surface` sheet under them, and the two interviewers in
  `--stage` tiles down the right. Nothing is illustrated *about* the product; the product is what
  is on screen.
- **The right-hand tile column is the split shell rotated.** DESIGN §1 is "a working console,
  split": a dark context column carrying what is true right now, against a working surface holding
  one subject. That is exactly what Ada and Turing are on this page, so the column is `position:
  sticky` and rides the whole exchange. This is the shell's own grammar, not a new layout.
- **Two grounds, no wash.** The night (`--rail`) and the document (`--bg`) are the shell's two
  shipped materials, alternating down the page. §2 rule 4 forbids a route painting a *wash* or
  opting into a different page background; it does not forbid the rail's own material appearing
  full-bleed, which `room` and `pre-join` already do. No gradient was added and none is needed —
  the "lamp" is a `clip-path` wipe, not a light source painted in colour.
- **The cast is drawn, not fetched.** `components/home/peeps.tsx` is one inline SVG per character
  with a shared bust and six moods, every stroke `currentColor` and every fill a token. It costs
  no request, no `<link rel=preload as=image>` and no hex — which is what keeps the §8.1 anonymous
  JS/asset budget and the token lint intact, and why the seeded persona *photographs* were not
  used here. Those are photographs of real people and belong in the room, where a candidate has
  consented to be in a session, not on a marketing page.
- **The mood is the round's own state, never decoration.** `moodFor()` derives it: asking while
  the question types, listening while the answer list is up, then `pleased` or `unconvinced`
  against the same 60 the copy already implies. An interviewer who reacted on a timer would be
  the "AI slop" the ask named. Colour never carries it either — the tile prints "Has the floor" /
  "Waiting" / "Round done" in words, per §6.
- **One authored motion moment, and it is the handover.** The lamp comes up once on mount (a
  `clip-path` wipe across the listing sheet, the two tiles rising behind it), and thereafter the
  only authored motion is the round changing hands: a hairline seam sweeps the exchange, the tile
  that lost the floor dims, the one that gained it lights, and both faces change. Every duration
  is `calc(var(--duration-default) * n)`, so `prefers-reduced-motion` zeroes the whole page from
  the one token rather than from six media queries.
- **The state machine was kept, the staging was replaced.** `useTyped`, `useSettled`, the
  render-phase reset that stops a new question painting at the previous one's length, the
  post-mount shuffle that avoids a hydration tear (issue 418), the `visibility: hidden` sizing
  span that stops the 217px shift (issue 237), the focus move to the result (WCAG 2.4.3) and the
  announce-once `role="status"` are all carried over verbatim from `demo-interview.tsx`. A
  rewrite that re-derived them would have re-earned every one of those bugs.
- **The three-step band became a drawn flow.** Numbered nodes sitting on hairlines that draw
  themselves on scroll (`animation-timeline: view()`, the precedent this page already set),
  rather than three same-size cards of heading-plus-text.
- **The header takes the rail's material on this route only** (`<SiteHeader onDark />`). The bar
  sits in flow above a `--rail` first viewport; left on `--bg` it was a light strip pinned over
  the night, and a light-to-dark flip on scroll would be worse than either. `/privacy` and
  `/terms` are unchanged. The landing's five section anchors are hidden below 48rem, where they
  wrapped the header into a 320px stack that covered the headline.

**Skipped, deliberately:**

- **No third character.** The desk is seen from the candidate's chair, so "you" has no portrait —
  which is also why exactly two exist.
- **No per-role listing provenance.** Drawing a line from the phrase in the listing to the question
  it produced is the strongest version of "written from your listing", and it needs three more
  authored passages per role in two locales. The flow band claims it; the demo proves it.
- **No new message key, and no copy rewritten.** Every string on the page was already in
  `messages/{en,tr}.json` and already good. `landing.howItWorks` and `landing.demo.title` are now
  unreferenced and were left in both files rather than deleted in a visual change.
- **The report's "out of five" still disagrees with the demo's "82 / 100".** Pre-existing: the
  anatomy copy and `SCORE_MAX` have always said different things. Not this ADR's to fix, and
  fixing it in a redesign would bury a copy decision inside a layout diff.

**Known, not fixed:** the focus ring is `--accent` on `--rail` at 2.1:1, under the 3:1 WCAG floor
for a non-text indicator. That is the app-wide recipe (`app-rail.module.css` and DESIGN §3.6), so
every rail surface shares it; inventing a second ring on the landing alone would be worse than the
defect. It wants one token decision across the app.

## ADR-ADD06 — the front door is public, and the doors in route by session

**Ask (owner, 2026-08-12):** every visitor can reach `/`, with no auth check. The navbar does not
change for a signed-in visitor — but pressing sign in or try now takes them straight to the app.
And an authenticated user must not be able to open register or sign-in.

**Shape chosen:**

- **The redirect off `/` is deleted, not weakened.** `components/home/home-switch.tsx` probed
  `/me` and `router.replace(firstRunPath(user))`, so a customer could not read the FAQ, re-check
  what the report contains, or send someone the demo without being thrown into the dashboard.
  With the redirect gone the component was `({children}) => <>{children}</>`, so it went too.
- **The guard moved to the three pages that are genuinely anonymous-only.**
  `components/auth/anonymous-only.tsx` is the same probe-and-replace shape, inverted, on
  `/sign-in`, `/register` and `/forgot-password`. Not a `(auth)/layout.tsx`: that group also holds
  `/verify-email`, which *requires* a session (`useRequireAuth`), `/verify-email/[token]`, which
  is public on purpose because the link is opened wherever the mail was read, and
  `/reset-password/[token]`, which a signed-in user clicking their own reset link has to reach.
  A layout guard would have broken all three.
- **`firstRunPath(user)`, not `DEFAULT_LANDING_PATH`** — K8.7 and issue 80. A signed-in visitor
  who never finished onboarding belongs at `/onboarding/1`, and sending every session to one
  landing path is what let a Google user skip onboarding entirely. `/sign-in?returnPath=…` is
  honoured through `safeReturnPath`, matching what the sign-in success handler already does.
- **It fails open.** Children render immediately and the guard renders `null` beside them. The
  alternative — withholding the form until `/me` answers — costs a layout shift on the anonymous
  path, which is nearly every render of these three routes, and makes the sign-in page permanently
  unreachable when the API is down, to the one visitor who most needs it. A signed-in visitor
  seeing a live sign-in form for one frame is the cheaper failure; nothing on these three screens
  is destructive.
- **Not middleware.** `use-require-auth.ts` already argues this and the argument holds inverted:
  the session cookie is opaque and `httpOnly`, so middleware can only see that a cookie *exists*.
  Here that is worse than on a protected route — a stale or revoked cookie would lock a user out
  of `/sign-in`, the page they need to recover.
- **The header renders one thing for everyone.** Both actions, both labels, always; only the
  destination changes once the probe answers. That retired the tri-state of issue 95 — it existed
  because the labels differed by session and a header that flashed the wrong doorway was worse
  than one that arrived late. With identical labels there is no wrong doorway to flash, so the
  links paint immediately with their signed-out hrefs and re-point when `/me` lands. The guard is
  the backstop for anyone who types the URL.

**Skipped, deliberately:**

- **`nav.today` was not deleted.** It looked like an orphan and is not — `shell/app-rail.tsx` and
  `report/report-rail.tsx` both still render it.
- **No loading state on the guard.** It needs a message key in both locales for a frame that the
  overwhelming majority of visitors never see, and it reintroduces the layout shift the fail-open
  decision exists to avoid.

## ADR-ADD07 — the Google callback lands inside the app, not on the front door

**Ask (owner, 2026-08-12):** after signing in or registering, land on the dashboard, not the home
page.

**What was actually broken:** only the Google path. Password sign-in and register both already
call `router.replace(firstRunPath(user))` at the point the session is issued. The OAuth callback
is a server 302 and passed no such call site — it redirected to `${PUBLIC_ORIGIN}/`, because for
issue 80 the *landing page* carried the K8.7 bounce (`home-switch.tsx`). ADR-ADD06 made `/`
public and deleted that bounce, so the same 302 left a Google user reading marketing copy.
A regression of ADR-ADD06, not a pre-existing defect.

**Shape chosen:**

- **`res.redirect(302, `${config.PUBLIC_ORIGIN}/dashboard`)`.** The destination is inside the app,
  where it always should have been; `/` was only ever chosen because it was the one route that
  applied the first-run rule.
- **The onboarding half of K8.7 moved to `/dashboard`.** That is the arrival no sign-in call site
  can cover, so the check belongs at the destination: `!user.onboardingCompletedAt` →
  `router.replace('/onboarding/1')`, and the page renders `null` until it resolves so the
  briefing never paints for a frame behind the redirect. Issue 80 stays closed — a Google account
  that has never onboarded still cannot reach the signed-in home.
- **Only the onboarding half.** Calling `firstRunPath` here would send a fully-onboarded account
  with zero interviews to `/interviews/new` and make `/dashboard` unreachable for them. The
  "where do I land" rule and the "may I be here" rule are different questions and only the second
  belongs on the page.
- **The rule was not put in `useRequireAuth`.** That was tried first and it is the tempting
  version — one home, every protected surface at once. It also silently changes what `/settings`,
  `/profile`, `/interviews` and the room do for a half-onboarded account, which is a product
  decision nobody asked for, and it broke 38 tests by doing it. The reported bug is one arrival;
  the fix is at that arrival. If the wider gate is wanted it should be its own change, with the
  exemptions (`/onboarding`, `/verify-email` — a candidate who cannot confirm their address must
  not be told to fill in a profile instead) decided deliberately rather than as a side effect.

**Also fixed:** the `/me` fixtures in `dashboard/page.test.tsx` omitted `onboardingCompletedAt`
and `interviewCount` entirely, so they did not match the payload the endpoint actually returns.
That is why the wider gate looked like it broke twenty unrelated tests.

## ADR-ADD08 — the console's cost charts, and how many colours the palette actually has

**Ask (owner, 2026-08-12):** a line chart, a stacked area chart, a bar chart, a table with
sparklines, a heatmap and a pie chart on the admin console, "for proper cost tracking, trend
tracking, tracking model shares to the total cost"; the shapes and their parameters ours to pick.

**Shape chosen:**

- **A new endpoint, not a wider `/admin/stats`.** Three of the six forms are time series and
  `/admin/stats` has no notion of a date — it answers one all-time question per figure. A window
  parameter on it would also change the meaning of every existing field for every existing
  caller. `GET /admin/costs?days=7|30|90` is separate, whitelisted, and fetched only when the
  Costs section is open. It carries `adminStatsLimiter` because it is the same class of read as
  the endpoint that limiter was written for (issue 85).
- **One graphic, one claim — which is why the line chart is not daily spend twice.** The stacked
  area is daily spend split by model, so its top edge *is* daily total spend; a line of the same
  figure beside it is the same fact drawn twice. The owner asked for both panels, so the second
  line is **cost per interview**: spend ÷ interviews started that day. That is the only figure in
  the set that separates price from volume — a total that rises because forty more people
  interviewed is not a cost problem, and no other graphic here can tell the two apart.
- **The bar chart is the range against the range before it.** Every other "spend by model" view
  is one value per model, which DESIGN §W11 already answers with a `Meter`. Two values per
  category is the one comparison a `Meter` cannot make, and "which model is growing" is the
  question the flat figures could never answer.
- **Three series, then Other — because the palette measurably holds three.** The registry ships
  `--series-1…6` and they were chosen to clear AA *as text on `--surface`*, which is a different
  test from telling two adjacent fills apart. Run through a CVD/ΔE check they fail as a
  categorical set: `--series-5`↔`--series-6` sit at ΔE 4.2 for deuteranopia and 14.2 for normal
  vision, below the 15 floor at which full-colour readers stop separating a pair; every subset of
  four or more fails on some pair. `--series-1/2/3` is the only subset that clears both the
  colourblind and the normal-vision floors (12.9 and 18.7). So the charts colour the top three
  models by spend and fold the rest into one bucket. The **table lists every model** with exact
  figures, so nothing is hidden by the fold — only uncoloured.
- **Other is `--surface-sunken` with a `--border` hairline, not a fourth hue and not
  `--text-muted`.** The obvious neutral collides with `--series-3` at ΔE 0.3 deutan — the two
  would be the same swatch to a deuteranope. The sunken fill separates by lightness and by
  outline instead of by hue, which is the same treatment `.day[data-tier='0']` already uses on
  the dashboard for "the empty ground". The previous-range bars take it for the same reason: a
  reference is not a series, and a hue spent on one is a hue the models no longer have.
- **Colour follows the model, not its rank.** `charts/series.ts` is the single place a model
  becomes a slot, so a model keeps its colour across the area, the bars, the donut, the table
  swatch and its sparkline — and changing the range does not repaint a model that survived the
  change. That shared identity is also why the legend is not repeated under every graphic.
- **The heatmap is the dashboard's practice grid, reused.** A 7 × 24 CSS grid of `data-tier`
  cells over the existing `activityTier` and its `color-mix` ramp off `--accent`. Not an SVG:
  the existing component already solved this exact problem, and a second tiering function is a
  second answer to "which step is this" that can drift from the first.
- **One sparkline scale, shared by every row.** A per-row maximum draws a model that spent
  $0.001 and one that spent $10 with the same silhouette, which is a lie about the comparison
  the column exists to support. The regression test makes two models 100× apart and asserts their
  `points` differ — under the per-row bug they are byte-identical.
- **The model table is the accessible rendering, and it is the only one.** Every SVG here is
  `aria-hidden` under a `<figure>` whose `<figcaption>` states the claim in words and numbers;
  the table carries every figure the area, the bars and the donut draw. Announcing them a fourth
  time is the noise ADR-ADD04 already refused. The heatmap is the exception that proves it: a
  colour ramp has no textual twin, so its caption names the peak bucket and its value.
- **Fixed-size SVG inside its own `overflow-x: auto`, never a scaled `viewBox`.** Scaling a
  viewBox scales the 13px type with it — the chart is either unreadable at 390px or oversized at
  1120px. This is the `.trendScroll` pattern the report chart already established, and it is what
  keeps the page body from ever scrolling sideways.
- **Still no chart library.** `recharts` remains installed and unimported (ADR-ADD04, ADR-W09).
  Every value here is a geometry or presentation attribute — `points`, `d`, `stroke-dasharray`,
  `stroke-dashoffset`, `transform`, `fill-opacity` — because the production CSP is
  `style-src 'self' 'nonce-…'` and drops the style attribute every chart library positions with.
- **The per-model `Meter` list is deleted, not kept beside the table.** The table is a strict
  superset of it: the same cost and latency, plus share, tokens and a trend. Two lists of the
  same numbers is how a surface starts disagreeing with itself.
- **An index on `llm_calls(created_at)`.** Every query here filters on a bare date range, and the
  existing `[interview_id, created_at]` cannot serve one. It is a genuine second btree insert on
  the table written by every provider call — the cost is real and taken deliberately, where the
  redundant prefix index that ADR rejected bought nothing.

**Skipped, deliberately:**

- **No per-cluster spend from the server.** The occupation breakdown is still summed from the
  loaded rows and still says so. Joining `llm_calls` → `interviews` → cluster is a fifth
  aggregation for a panel nobody asked about in this round.
- **No hover, tooltip or crosshair layer.** Every figure these charts draw is already printed as
  text in the table below them, so a tooltip would be a fourth copy of a number the reader can
  already read — and it would need a positioned element, which is the CSP problem again.
- **No all-time range.** An unbounded scan is precisely what `stats.ts` refused when it declined
  the `take:` cap, and 90 days is the ceiling that keeps this endpoint's cost bounded.
- **No CSV or export.** The console is a reading surface; an export is a different feature with
  its own audit question.
- **`--series-4/5/6` stay in the registry, unused by these charts.** They are still valid ink for
  a surface that needs one or two of them in isolation — the report chart uses 1 and 3. What the
  measurement rules out is treating all six as a categorical set, not the tokens themselves.
- **No `ADMIN AUDIT` grep markers in `costs.ts`.** Every query in it deliberately counts
  soft-deleted interviews, which the convention in `modules/admin` marks with a comment (ADR-N01).
  This work was done under a standing no-comments instruction, so the marker is recorded here
  instead. `grep -rn "ADMIN AUDIT" modules/admin` no longer returns every such read; restoring
  the four one-line markers is the fix if that convention is to hold.

## ADR-ADD09 — one panel instead of seven cards, and the filter's real scope

**Ask (owner, 2026-08-12):** carry the filter into the container of the table it belongs to, "in
the same container top-down"; and on Costs, compress the title, the chart and the range into one
container behind a dropdown that picks between charts — or between chart types for the same data,
"available, applicable ones".

**Shape chosen:**

- **The filter moved because it was claiming scope it never had.** It floated on `--bg` above
  whatever the section rendered, which on Costs put it above six graphics fed by `/admin/costs` —
  an endpoint that does not read the filter bag at all. A control positioned over a region reads
  as scoping that region. Inside the `.head` of the table it filters, it can only claim the rows
  underneath it, which is exactly what it does. The layout ask and the correctness fix are the
  same edit.
- **One optional prop, not five layouts.** The five tables were already the identical
  `.card > .head > .scroller > table` shell, so `filter?: ReactNode` rendered at the end of `.head`
  covers all of them. The drill-down had been doing this by hand since it was written; it now
  takes the same wrapper, so the two surfaces space it the same way instead of by coincidence.
- **On Costs the filter is now at the bottom, and that is correct.** It sits with the interview
  list, which is the only thing on that surface it narrows. A filter high on the page that
  silently governs one card near the bottom is the failure the whole filter-builder exists to
  avoid (§W11 "Chips").
- **Six questions, one panel.** Seven stacked cards was 4400px of scrolling to reach a heatmap,
  and any given operator wants one of them. A `Chart` select picks the question and a `Drawn as`
  select picks the form, sharing the strip with the range control.
- **The type list is per-question, so the control cannot lie.** A form is offered only where it
  answers the same question: a part-to-whole gets a donut or bars, never a line; a time series
  gets a line, an area or columns, never a donut. Where one form is honest — this range against
  the last, when the money lands — the second select is **absent**, not a select with a single
  option. A control with one choice is furniture that looks live.
- **The type is remembered per question.** Switching away and back returns the drawing the
  operator left it on. Resetting to the default is a second decision they did not make.
- **The model table never goes behind the dropdown.** Every drawing here is an `aria-hidden` SVG
  whose text counterpart is that table (ADR-ADD08). If the table were a seventh view, choosing
  any chart would leave the surface with a graphic and no accessible form of it. It stays below
  the panel, always rendered.
- **One plot shell.** `trend-lines`, `model-mix` and `model-delta` each carried their own copy of
  the gutter, gridlines, ticks, axes and date labels. That is now `charts/plot.tsx`, and a chart
  *type* is only the marks drawn inside it — which is why three new forms (area, columns, stacked
  columns, one line per model) cost roughly one file rather than four. `area` needed no new
  geometry at all: `stackBands` with a single series already returns that polygon.
- **The residual series is dashed when it is a line.** As a fill it is `--surface-sunken` with a
  hairline (ADR-ADD08). A line has no fill to be pale, so it takes `--text-muted` — which is
  ΔE 0.3 from `--series-3` under deuteranopia — plus a dash pattern. The dash is the separation;
  the colour is not doing that work.
- **The multi-line form scales to the tallest series, the stacked forms to the stacked total.**
  Same data, two different axes, because "how big is this model" and "how big is everything" are
  different questions. A test asserts the line form reaches higher in the plot than the stacked
  one for identical input, so the axes cannot silently be unified.
- **One empty-state line, owned by the panel.** The note used to live in each chart card, so
  deleting six cards deleted it for three of the six views — they drew a flat zero line under a
  caption that confidently read "0.000000 a day on average" and never said nothing was spent.
  The panel now decides emptiness per view and the `figcaption` carries the sentence, and the
  test asserts exactly one occurrence, so it can neither vanish again nor be printed twice.

**Skipped, deliberately:**

- **No URL or storage persistence for the chosen view.** Add it when someone needs to link a
  colleague to a specific chart; until then it is state nobody asked to survive a reload.
- **No hover or tooltip layer.** Unchanged from ADR-ADD08: the table below prints every figure,
  and a tooltip needs a positioned element the CSP would drop.
- **The plot is still a fixed-width SVG in its own scroller.** It grew to 880 × 220 now that it
  owns the card alone, but it does not measure its container. Scaling a `viewBox` scales the 13px
  type with it, and measuring means a resize observer for a chart that already fits every desktop
  width the console supports.
- **No second panel for side-by-side comparison.** It was offered and declined; two half-width
  panels would each scroll a fixed-width chart, which is worse than switching between them.

## ADR-ADD10 — comparing named series, and what a palette of three can honestly draw

**Ask (owner, 2026-08-12):** the charts have nothing to compare in line or area form — "I want to
compare elevenlabs and openai or their models etc. we should build up a dynamic selectable way."

**Shape chosen:**

- **The fold was in the wrong layer, and that was the actual bug.** ADR-ADD08 had the endpoint
  return the top three models plus an `Other` row. That is a *presentation* decision, and making it
  server-side meant no client could undo it: of the five `(provider, model)` pairs the platform
  calls, two were absent from the payload entirely. No picker could have offered them. So
  `/admin/costs` now returns every model, ranked, and `charts/fold.ts` rebuilds three-plus-Other at
  render time. The model table stopped hiding two models as a side effect — that was a real gap
  nobody had filed yet.
- **A hard cap, and it says so.** 24 models, with `truncated` counting what was dropped. The fold
  it replaces was lossless-but-invisible; a cap is lossy, so it is announced. Silent truncation
  reads as "that is everything", which is the failure `stats.ts` names in its own header.
- **A model that stopped being used still appears.** It is seeded with zeroed current figures and
  its real previous-window spend. Dropping it would hide precisely the change an operator opened
  the comparison to find.
- **Four daily arrays, no new query.** `costUsd`, `calls`, `tokens`, `latencyMs` per model per day.
  Query 1 already computed all four per `(day, provider, model)` and threw three away. Latency by
  provider is a genuinely different question this data always answered and nothing on the console
  surfaced.
- **Compare is its own view, and it never stacks.** Filtering a *stacked* chart makes its silhouette
  a lie about total spend — the figure card above it would contradict the chart below. So
  `Spend by model over time` keeps showing everything, and the subset comparison is unstacked and
  separate. Two questions, two views.
- **Six slots: three hues, then the same three dashed.** The palette clears exactly three
  categorical hues (ADR-ADD08). Slots 4–6 reuse them with a dashed stroke, so the 1↔4 pair has a
  colour ΔE of **zero** and is separated entirely by a non-colour channel. That is only honest
  because the picker chip *is* the legend: each chip carries a 16×2 swatch showing its colour and
  its stroke pattern next to the name it belongs to, so identity is never colour-alone and never
  needs a second lookup. Six is the ceiling and the seventh chip is `disabled` with a line saying
  why — a control that silently ignores a click is worse than one that refuses.
- **Provider rollup is client-side and exact.** Every model row carries its provider, so grouping
  is a sum over `microUsd` integer micro-dollars — no float, no extra query, no second endpoint
  shape to keep in step. Latency rolls up weighted by calls; averaging the averages would let one
  rare slow model outvote ninety fast ones.
- **One measure at a time.** Spend, calls, tokens, average latency — switched, never combined,
  because two measures on one chart is a second y-axis. The axis formatter follows the measure.
- **"Not reported" is said out loud.** Under Tokens a per-second voice model draws a flat zero
  because it stores no token count. A note names those series. An operator reading that line as
  "costs nothing" is the exact misreading the note exists to prevent, and it is the same duty of
  care `unpricedNote` already discharges for a zero cost on an unpriced model.
- **Nothing selected is not "nothing spent".** Unticking every series says the chart is waiting
  for one, not that the range is empty. Two different facts never share a sentence here.

**Skipped, deliberately:**

- **No small multiples past six.** It was the scalable answer and it was declined for a platform
  with five models; a grid of tiny charts is a second rendering mode to build and maintain for a
  case that does not exist yet. Revisit if the provider list grows.
- **No persistence of the picked series.** Same reasoning as the view picker in ADR-ADD09: add it
  when someone needs to send a colleague a link to one comparison.
- **Filled areas still muddy past three.** Six translucent overlapping areas is unreadable; the
  lines on top stay legible, so `area` is honest at two or three series and degrades gracefully
  rather than being forbidden. Named here rather than guarded in code.
- **`--series-4/5/6` are still unused as hues.** Nothing measured has changed since ADR-ADD08.
  The dashed variants are how the chart gets past three, not a quiet re-admission of those tokens.

## ADR-ADD11 — the vitest integration ring gets the guard the acceptance ring already had

**Ask (owner):** "Almost all the tests writing to the production db, must be fixed."

**What was actually true.** The file-pattern gating was already correct: every test that touches a
real Prisma client is named `*.integration.test.ts` and both vitest configs exclude those unless
`INTEGRATION=1`. Every other test in the tree mocks `@prisma/client` or `src/lib/db`. So no
ungated test wrote anywhere.

What was wrong is what `npm run test:integration` was *pointed at*. It loaded the repo-root `.env`
with `--env-file-if-exists`, and `.env` names `db:5432/interviewly` — the application's own
database. Six of the eight integration files carried a header telling the developer to
`export DATABASE_URL=postgresql://…@localhost:5432/interviewly` (the same database, host-reachable)
and `export REDIS_URL=redis://localhost:6380` (logical db **0**, the application's keyspace).
Three of them — `state`, `answers`, `conductor` — have no cleanup at all. This is issues #170/#119
a second time: the acceptance ring learned that lesson and got `cucumber.js`'s forced store URLs,
`interviewly_test`, `assertDisposableStores` and a Redis-index rewrite; the vitest ring, built
separately, never received any of it.

**Shape chosen:**

- **The same fix, in the same place in the pipeline.** `cucumber.js` resolves both URLs *before*
  `loadEnvFile`, because Node leaves an already-set variable alone — that ordering is what takes
  `.env` out of the decision. The vitest ring has no such file, so the resolution moved into the
  `test:integration` script itself, ahead of `--env-file-if-exists`, with the identical precedence:
  exported `TEST_*` first, then an exported `DATABASE_URL`/`REDIS_URL` (how CI points at its
  ephemeral services), then the disposable localhost defaults `compose.dev.yaml` publishes.
- **Reused `assertDisposableStores`, did not write a second guard.** It already refuses any
  database whose name does not end in `_test`/`ci` and any Redis db 0, and it already deliberately
  imports nothing so it can run before `env.ts` validates a key. `vitest.global-setup.mts` calls
  it. A guard that differs per ring is a guard with a hole — that sentence is already in
  `disposable-stores.ts`, and this is the second ring it now covers.
- **Root-level `globalSetup`, not a per-project `setupFiles`.** It runs once for `node` and
  `worker` both, which is what the migrate below wants, and the env resolution it validates
  happened in the shell so it is inherited by every worker rather than needing to propagate.
- **`prisma migrate deploy` in the global setup.** `db/init.sql` creates `interviewly_test` with no
  tables in it, and nothing in this ring deployed migrations into it — so pointing the ring at a
  disposable database without this makes it fail on the first query instead of on the guard.
  Idempotent, and it is what makes `npm run test:integration` work on a laptop at all, which
  `AGENTS.md` previously said out loud that it did not.
- **Two seeded reference personas in the global setup.** This is the bug in its purest form and it
  is worth naming: `conductor.integration.test.ts` creates its own persona row, but
  `seededPersona` looks up `id = seed-persona-{hr,tech}` or `role = {hr,tech}` — so 15 of its tests
  were passing only because the *seeded production database* had those rows. Personas are
  reference data (`schema.prisma` says so of `OccupationCluster` in the same words), so a
  disposable database needs them the way it needs its tables. Upserted with `avatar_set: {}` and no
  object-storage writes — the seed script's `seedPersonas` uploads six avatar objects and would
  drag MinIO into a ring that stands up Postgres and Redis.
- **`NODE_ENV=test` on the ring.** `REPORT_QUEUE_PREFIX` is `'acceptance'` under it and `undefined`
  otherwise, so without it `consumer`/`failure`'s real BullMQ enqueues went onto the same queue
  name a running production worker consumes from. The database was not the only shared store.
- **`LOG_TRANSPORT=stdout` on the ring**, for the same reason the vitest configs already force
  `AI_ENABLED=false`: a developer's `.env` with `elastic` puts a pino thread-stream in front of an
  Elasticsearch that is not running, and `shutdown.integration.test.ts` then hangs on
  `process.exit(0)` after logging `SERVER_STOPPED` — a 15s timeout with no useful message. A test
  ring must not reach a live external service, and this one did.
- **CI spells the Redis index out** (`redis://localhost:6379/1`) rather than this ring rewriting a
  db-0 URL the way `cucumber.js` does. Two mechanisms for one rule is how they drift; the ring
  refuses and names the fix, and the one caller that needed changing is one line of `ci.yml`.
- **The wrong instructions were deleted, not corrected.** Those six `export DATABASE_URL=…` lines
  are why this happened. With the script supplying exactly those defaults they are also now
  redundant, so the block is `docker compose … up -d db cache` then `npm run test:integration`.

**Verified:** `npm run test:integration` against `interviewly_test` — 8 files, 43 tests, 41
passing before the ADR-ADD12 cap change landed in the same branch (the two remaining failures are
that change's, and are fixed under it). The refusal itself was observed firing against `.env`'s
`interviewly` before the script change was made.

**Skipped, deliberately:**

- **No cleanup added to `state`/`answers`/`conductor`.** They write into a disposable database now;
  a `afterAll` that hard-deletes across `ON DELETE RESTRICT` FKs in the right order is real code to
  maintain for rows nothing reads. `stats.integration.test.ts` already does it and can keep to it.
- **`ACCEPTANCE_ALLOW_DESTRUCTIVE_DB` keeps its name** even though a second suite now honours it.
  It is documented in `AGENTS.md` and set in developers' shells; renaming an escape hatch to make
  it read better is how an escape hatch stops working. Only the refusal *message* was generalised,
  since it named acceptance's TRUNCATEs to someone running vitest.
- **No `SHADOW_DATABASE_URL` handling.** `migrate deploy` does not use one.

## ADR-ADD12 — one follow-up per question, enforced where it is advertised

**Ask (owner):** "Still follow-up/clarification question are too much. It is impossible to
complete an interview under 20 minutes (6 questions long)."

**What was already there.** The server-side cap exists and works: `runTurn` recomputes
`turnsOnQuestion` from `chat_messages` on every turn (no counter to persist, no column to
migrate), and `clampAction` rewrites a non-advancing action to `drift`, which advances and writes
an honest system note. Two things were wrong with it, and the prompt lever had already been pulled
three times — v2's own header documents this exact complaint.

1. **The value bought three follow-ups.** `CONDUCTOR_MAX_TURNS_PER_QUESTION=4` = four candidate
   utterances on one question, while the live prompt said "at most once per question". Six
   questions × four utterances is 24 model round-trips, each one in voice carrying up to 8 STT
   calls, a completeness-gate call and a TTS synthesis.
2. **The hint and the check disagreed by one turn.** `allowedActions` withheld `continue` at
   `turnsLeftOnQuestion <= 1`; `clampAction` drifted at `<= 0`. A model that ignored the
   allowed-actions list got exactly one free extra probe *and* the candidate then ate the drift —
   the cut-off-mid-thought failure v2 was written to stop.

**Shape chosen:**

- **3, not 2.** At 3 the arithmetic is: answer (2 left, probe allowed), follow-up answer (1 left,
  the interviewer's own turn to close the question in its own words), advance. At 2 there is no
  follow-up at all and the first answer is immediately terminal, which is a different product.
  Twelve candidate utterances for a six-question interview instead of twenty-four.
- **One exported predicate, `mayProbe(turnsLeftOnQuestion)`, called by both sides.** It lives in
  `packages/ai/src/prompt-vars.ts` next to `allowedActions` and is re-exported from the barrel the
  backend already imports, so `allowedActions` (the hint) and `clampAction` (the enforcement) are
  the same decision by construction. A new unit test loops 3/2/1/0 and asserts the offer equals
  what is honoured — the two cannot drift apart again, which is what they had done.
- **No wall-clock cut for text interviews.** It was considered and declined. `isPastSpeechCeiling`
  is voice-only, `activeSeconds` is banked in both modes, and wiring the ceiling into `runTurn`
  would have been three lines. But the ask is that an interview *finishes* inside twenty minutes,
  and a timer does the opposite: it ends interviews at twenty minutes with `time_exhausted` and no
  report worth reading. Fewer turns is what makes it finish; a deadline only makes it stop.
- **Prompt bumped to v5, not edited** (K9). v4 said "At zero the server advances for you", which
  the new boundary makes false, and a prompt that misstates its own budget is how the model
  over-spends it. v5 states the arithmetic it is actually under and keeps v4's promise that the
  last turn belongs to the interviewer rather than the server.

**Verified:** `npm test` 127 files / 1395 tests; `npm run test:integration` 43/43;
`test:acceptance` 111 scenarios and the auth profile's 36.

**Consequence worth knowing:** `mayEnd`'s `turnsOnQuestion >= 3` clause is unreachable at the
default now — the forced advance fires at 2. Behaviour is unchanged (a candidate who will not
participate reaches `current_index > 1` through the drift and `mayEnd` is true on their third
utterance exactly as before), and the clause becomes reachable again if the knob is raised, so it
was left alone rather than deleted.

**Also fixed here, because the cap exposed it:** two integration tests spent more turns on one
question than the new budget allows and then failed the advance CAS on their own stale interview
snapshot rather than on the assertion. `stores the whole answer window (C01)` builds its answer
across two utterances instead of three (the defect it guards — scoring only the last utterance —
is caught identically), and the T03 silence loop runs `MAX - 1` times, which is where the drift
now fires for any value of the knob.

## ADR-ADD13 — the listing is the anchor, the CV is background

**Ask (owner):** "While generating questions, we must heavily depend on the dynamic part, job
listing. Agent always asks about CV's specific parts, which makes the UX bad. HR, Technical must
review the user like they are really part of the listed job."

**Where it came from, precisely.** Two prompts, and the CV was winning both.

- `interview.question.generate` v2 was deliberately written to push toward the CV (v1 put the CV
  block in the user message with no instruction, so questions ignored it — issue 62's other half).
  v3 kept that paragraph: six lines telling the model to ground questions in the CV's roles,
  projects and tools and to "Name a specific thing from the CV in a question whenever that makes
  the question sharper." The listing got one clause: "a 'tech' round asks about the concrete
  skills the listing names." The correction for one imbalance had produced the opposite one.
- `interview.conduct.turn` has injected `<candidate_cv>` since v1 and **no version has ever said
  what that block is for.** An unlabelled CV next to "you are conducting a live job interview" is
  an invitation, and free-associating off the resume is the natural reading.

**Shape chosen:**

- **Two new prompt versions, no code change.** `interview.question.generate` v4 and
  `interview.conduct.turn` v5 — same uuid, same name, version incremented, v1–v3/v1–v4 untouched
  (K9). `live-client.ts` pins no version and `registry.resolve()` serves the highest, so the new
  files go live on deploy while `llm_calls.prompt_version` keeps every past turn attributable.
- **The listing is named as the anchor, not merely mentioned.** v4: every question must test a
  requirement, responsibility or skill the listing actually names; if the listing is thin, write
  from the role it describes — its seniority, its domain, the work it implies — rather than
  falling back on the CV. `<job_listing>` also moved to the top of the user message, ahead of the
  candidate blocks.
- **The CV is demoted to a level-setting device, and the bad shape is named.** It may pitch
  difficulty and seniority and steer away from what the listing does not need; it is never the
  subject of a question, and "tell me about `<project/employer/tool>` on your CV" is forbidden
  explicitly rather than discouraged in general. The `no cv provided` marker and the 12 000-char
  truncation are untouched — both are asserted by the acceptance suite.
- **The conduct prompt says what its data blocks are for.** v5 adds the section that never
  existed: you are interviewing this candidate for the role in `<job_listing>`, probes assess
  fitness for its stated requirements, `<candidate_cv>` is background, never open a probe with
  "on your CV you mention…", and if the candidate raises their own experience follow it only as
  far as it speaks to a listing requirement.
- **The reply contracts are byte-identical.** `intent`/`text` on the generate side
  (`QuestionSchema`, and the `intent ?? null` insert in `generation.ts`), and the action list,
  `avatar`/`widget`/`set_interview_language` and JSON shape on the conduct side
  (`ConductorTurnSchema`, `clampAction`). Placeholder sets are unchanged — an extra or missing
  `{{…}}` throws `AI_PROMPT_BUILD_FAILED`.
- **A test pins the anchoring.** No existing test asserted anything about question *content*, so
  re-anchoring broke nothing — and nothing would have caught it being quietly reverted either.
  `prompt-builder.test.ts` now asserts the live generate prompt carries the listing-anchor
  sentence and "It is never the subject of a question", and does not carry v3's "Name a specific
  thing from the CV".

**Skipped, deliberately:**

- ~~**`interview.report.generate` still never sees the job listing.**~~ **Done in the same branch,
  on the owner's instruction — see ADR-ADD15.** It was named here as a deferral because it needs an
  `AiClient` arg change as well as a prompt version, which is more surface than a prompt-only
  re-anchor; leaving it would have meant the interview assessed the job and the report then graded
  the resume.
- **`interview.question.candidates` sees neither listing nor CV**, and its output overwrites a
  pending question's `text`/`topic`/`difficulty` — so a re-anchored batch could in principle be
  replaced by a listing-blind question. It cannot happen today: `promoteNextQuestion` returns
  early when a question has no pre-generated candidates, which is every interview. Left alone,
  with the same caveat as above.
- **The persona briefs (`Ada`, `Turing`) were not touched.** They say nothing about the listing or
  the CV, and the conduct prompt's new section covers both personas at once; a seed change would
  need a re-seed to take effect on any existing deployment.

## ADR-ADD14 — a landing on `/interviews/new` with a job attached is a row

**Ask (owner):** "Write all interview/new landings to db, if they has a text, jobid, jobtitle and
jobcompany (parameters can be found in the browser-extension/)."

Those four are exactly what `browser-extension/content.js` puts on the URL it opens:
`?prefill=<listing text>&jobTitle=&jobCompany=&jobId=<LinkedIn numeric id>`. Nothing in the repo
read three of them — `page.tsx` used `prefill` and dropped the rest on the floor.

**Shape chosen:**

- **A new table, `job_listings`, not columns on `interviews`.** This is the one decision that
  needed making. `schema.prisma`'s own header restricts feature work to nullable columns and
  indexes, and three nullable columns on `interviews` would have been the protocol-legal answer —
  but they cannot hold the thing being asked for. A landing is not an interview: most landings
  never become one, and "write all landings" is a row that exists before, and often instead of,
  an interview row. So this is a deliberate, recorded exception to that rule rather than a
  workaround that answers a different question. Six columns, cuid id, `created_at`, FK
  `ON DELETE RESTRICT`, `@@map("job_listings")` — the conventions every other model here follows.
- **Upsert on `(user_id, external_job_id)`, not append.** The unique index is both the dedup key
  and the only read path, so no second index was added. Re-landing on the same LinkedIn job
  refreshes the captured title/company/text instead of adding a row; the alternative is a table
  whose row count measures page refreshes. No landing counter and no `last_seen_at` — neither was
  asked for, and both are additive later.
- **Authenticated, on the existing interview router.** It inherits `requireAuth` and
  `requirePublicOrigin` from the router rather than re-declaring them, which is what that router's
  own comment asks new routes to do. Deliberately *not* an anonymous endpoint: an unauthenticated
  write reachable from any origin is a different security decision, and the rows are keyed to a
  user anyway. Consequence: the capture is a POST from the landed page, never from the content
  script — a POST from `linkedin.com` would be refused `CSRF_ORIGIN_MISMATCH`, correctly.
- **A rate limiter, because the endpoint is loopable.** 60/hour per user, `keyedLimiter`, declared
  beside the other three. No admin bypass; this protects rows, not a product quota.
- **Bounded input.** `job_text` at `MAX_BLOCK_CHARS` (12 000), the same ceiling `uploads.ts` uses
  for a listing, logged as `LISTING_TRUNCATED`; title, company and the external id at 300. Three
  unbounded `TEXT` columns behind an authenticated but loopable endpoint is the wrong kind of
  lazy.
- **No new error code.** `VALIDATION_ERROR` already means "this body cannot build the thing", so
  there is nothing new for `error-codes.ts` or for the EN/TR `errors` namespace to carry. The
  capture is silent by design — no visible UI, therefore no message keys at all, and a failure
  never interrupts the setup flow the visitor actually came for.
- **The sign-in round trip had to be fixed for any of this to fire.** `signInPathFor` encoded only
  the pathname, so a signed-out extension landing lost the whole payload before sign-in — no
  capture, and no prefill either, which was a pre-existing bug in its own right. It now carries
  the query string. `safeReturnPath` needed no change: it already accepted a query and decides
  both hostile forms (`//evil…`, `/\evil…`) on the first two characters, so a query cannot reopen
  them — tests were added pinning exactly that rather than rewriting a correct guard.
- **`window.location.search` in `useRequireAuth`, not `useSearchParams`.** That hook is used by
  many pages; `useSearchParams` there would force a Suspense boundary onto all of them. The read
  happens inside the effect, so it is client-only and needs no boundary.

**Erasure, decided rather than deferred.** `auth/delete-account.ts` anonymises the user row in
place and soft-deletes interviews, so a `job_listings` row — keyed to `user_id` and attached to no
interview — would have survived an Art. 17 / KVKK request untouched. It is personal data: which
vacancies an account browsed is a behavioural record of that person, and unlike `llm_calls` or
`interviews.spent_usd` there is no operator cost ledger behind it that K11 needs to keep reading.
So the erasure transaction **deletes the rows outright** rather than anonymising them — the same
call, for the same reason, that `email_tokens` already gets: nothing references them, so there is
no `RESTRICT` to work around and nothing is left to anonymise. The acceptance fixture now creates
a captured listing that outlives the interview beside it, and `no personal data remains` asserts
the count is zero — the scenario would otherwise have passed while the row sat there.

## ADR-ADD15 — the report grades against the listing too

**Ask (owner):** close the items ADR-ADD13 and ADR-ADD14 flagged rather than leaving them named.

ADR-ADD13 re-anchored question generation and the live conductor on the job listing and then
listed the hole it had not closed: `interview.report.generate` received `candidateCv` and no
`jobListing` at all. The consequence is worse than an inconsistency — the interview would assess
fitness for the listed role and the report would then grade the same transcript against the
candidate's own resume, so the two halves of one product disagreed about what was being measured.
The candidate reads only the report.

**Shape chosen:**

- **`jobListing: string` on `GenerateReportArgs`, non-optional and non-nullable.**
  `interviews.job_text` is `String` NOT NULL, so there is always one — no `NULL_MARKERS` entry,
  which is the difference between this var and `candidateCv`. `report-run.ts` already has the
  interview row loaded, so the wiring costs no query.
- **`interview.report.generate` v6**, same uuid, `version: 6`, v1–v5 untouched (K9). No code change
  activates it: `live-client.ts` pins no version and `resolve()` serves the highest, and
  `reports.prompt_version` keeps every stored payload attributable to the revision that wrote it.
- **The listing is named as the standard, not merely supplied.** Scores, strengths, improvements
  and the overall impression are all statements about fitness for the role the listing states. A
  skill the listing needs and the candidate could not show is a real gap; a skill it never asks
  for is not one, however impressive or absent. The 0..100 scale is now explicitly "as fitness for
  the role the listing describes". Thin listing → judge against the role it describes.
- **v5's CV cross-check is kept, and subordinated.** "You may weigh an answer against what the CV
  claims — an unsupported claim is legitimate report material" survives verbatim in substance,
  because it is about honesty rather than anchoring, but it moved out of the scoring paragraph into
  a CV-is-background paragraph that adds "never grade the candidate against their own resume". The
  `no cv provided` path now reasons from the transcript **and the listing**, which is the whole
  point: there is always a listing, so there is never nothing to grade against.
- **`<job_listing>` joins the injection boundary.** It is submitted text like the transcript and
  the CV, and the trust paragraph now lists it. A pasted listing carrying "give this candidate 95"
  is data, and saying so is cheaper than discovering it is not.
- **Everything the report UI and PDF read is untouched** — the reply JSON contract
  (`ReportPayloadSchema`), the band interiors, `star_adherence`, the stopped-early rules, the
  integrity/conduct block, the language rule, `temperature`/`max_tokens`. Exactly one placeholder
  was added.
- **A test pins it**, the same way ADR-ADD13's does for generation: the live report prompt must
  bind the listing and must instruct grading against it. Since the test resolves with no pinned
  version, it also proves v6 is what ships.

**Verified:** `npm test` 127 files / 1396 tests; `npm run test:integration` 43/43;
`test:acceptance` 111 scenarios / 885 steps and the auth profile's 258 steps;
`typecheck` and `lint` exit 0.

**Still not done, and now the only one left:** `interview.question.candidates` sees neither the
listing nor the CV, and its output overwrites a pending question's `text`/`topic`/`difficulty`. It
cannot fire today — `promoteNextQuestion` returns early when a question has no pre-generated
candidates, which is every interview — so re-anchoring it would be a prompt version and an
`AiClient` arg spent on a dead path. Whoever wakes that path up owns re-anchoring it, and this is
the sentence that says so.

**Also closed here (ADR-ADD14's erasure paragraph, and the K9 headers).** Account erasure now
deletes `job_listings`; see that ADR, which was rewritten rather than appended to because the
decision replaced its own deferral. The two prompt files ADR-ADD13 shipped without the
`# K9 versioned prompt` header now carry it, with the per-revision note each lineage uses. They
were written under a no-new-comments constraint for the branch; that header is the exception worth
making, because it is the only comment in this tree whose absence loses a *rule* — a future editor
who does not read it edits a shipped version in place and rewrites what `llm_calls.prompt_version`
claims about the past.


## ADR-ADD16 — the adaptive path was never alive, and two provider bugs are why

**Ask (owner):** prove adaptive questioning works end to end. It did not. This is the fix.

`promoteNextQuestion` scored every answer and promoted nothing, always. Not a dead gate — the
pool behind it failed on both providers, for two unrelated reasons:

- **OpenAI cannot emit a top-level array.** `response_format: json_object` is sent on every
  prompt; `interview.question.candidates` v1/v2 asked for `[{…}]` and validated against a bare
  `z.array`. Unreachable shape. The only array-rooted schema in the tree.
- **The gemini fallback spends its budget thinking.** `gemini-2.5-flash` charges thinking against
  `maxOutputTokens`: 765 of 800 measured, `finishReason: MAX_TOKENS`. Tier-2 has been decorative
  for every prompt in the tree, not just this one — `turn.complete` has 30 tokens, `score` 600.

**Shape chosen:** `thinkingConfig: { thinkingBudget: 0 }` fixes the tier in one line rather than
raising eight `max_tokens`, and matches tier-1, which is non-thinking throughout. Candidates v3
(same uuid, K9) returns `{"candidates":[…]}` like `QuestionBatchSchema` already does, so the
outlier is gone rather than special-cased; the seam still returns `Candidate[]`. v3 also binds
`<job_listing>`, which ADR-ADD15 assigned to whoever woke this path up. The transports get their
first request-body tests: every existing chain test injects a mock, so both bugs lived in the two
functions the suite never called.

**Verified:** six-question text interview on an image from this branch — 5/5 promotions, every
difficulty matching `selectNextQuestion` including the floor clamp, no provider fell back.
`npm test` 1400, `@adaptive-questions` 7 scenarios, typecheck and lint clean.

**Known, not fixed:** the conductor overwrites the promoted row's `text` and leaves its `topic`,
so a label can stop describing its question. Audit surface, predates this branch, conductor's call.

## ADR-ADD17 — the stack is measured where it is deployed: `--scale api=N` behind the same edge

**Ask:** make the system ready for a scaling test, then run one — instance multiplicity, latency
(with a profiler, to be implemented) and performance — proving every number, with scripts that
re-run it, JSON that holds the evidence and a PDF built from that JSON.

There is already a `platform` ledger (P01–P09, all `todo`) planning Fly.io, `kind`, an HPA and a
k6 harness. Nothing here consumes it or closes it; this is the local, free, same-machine subset it
was going to compare against, and the deviations from its ADRs are named below.

**Shape chosen:**

- **`docker compose up --scale api=N`, not a second orchestrator.** The four images, the edge and
  the two stores are already the deployment; scaling one service inside it changes one number and
  nothing else. Fly and Kubernetes cost money and a cluster to debug, and neither answers "does a
  second replica carry more traffic" any better than a second container does.
- **Caddy resolves its upstreams, rather than naming one.** `reverse_proxy api:4000` dials a
  hostname whose A record Docker rotates, but a keep-alive pool pins the connection it got — two
  replicas, one of them idle. `dynamic a { name api; port 4000; refresh 5s }` with
  `lb_policy round_robin` makes the upstream set the DNS answer, re-read every 5s, so a replica
  added or removed mid-run is picked up without touching the edge. This is the single change that
  turns N containers into N serving replicas, and the harness refuses to run if the edge cannot
  reach every one of them.
- **A third compose overlay, not an edit to the two that exist.** `compose.dev.yaml` publishes
  `127.0.0.1:4000:4000` for `api`, which is exactly what makes a second replica fail to start —
  so the scale run cannot use it. `compose.scale.yaml` publishes what a *measurement* needs
  (Postgres, Redis, for `pg_stat_database` and `INFO clients`), pins the Prisma pool, and forces
  `AI_ENABLED=false` and `LOG_TRANSPORT=stdout`. The production file is untouched.
- **The connection pool is pinned, and that is a finding rather than tuning.** Prisma's default is
  `2 × cores + 1` — 17 on this host — *per process*. Four api replicas plus the worker plus the
  migrate job is over Postgres' `max_connections = 100` before a single interview is served. The
  overlay sets `connection_limit=10` (`SCALE_DB_POOL`) so the run measures the application rather
  than a connection storm, and the number is printed in the report so the ceiling is visible.
- **The profiler is in the process, not a scrape target.** Prometheus would be a dependency, a
  port, a compose service and a query language to answer three questions that Node already
  answers: `process.hrtime.bigint()` around a request, `perf_hooks.monitorEventLoopDelay()` for
  the queue behind it, `process.cpuUsage()` for what it cost. `backend/src/lib/profiler.ts` keeps
  a bounded ring of 4096 samples per route pattern — never per concrete path, or one interview id
  would be its own row — and computes percentiles when asked instead of on every request.
- **`X-Instance` is a hash, not the hostname.** Attribution needs the replicas to be *distinct*,
  not *named*; the first 8 hex of `sha256(hostname())` is stable for the life of the container and
  tells a client nothing about the host. It is what makes the fan-out claim a count rather than an
  assertion.
- **The snapshot is an admin route, not an open port.** `GET /admin/perf` and
  `POST /admin/perf/reset` sit behind `requireAuth, requireAdmin` like every other operator read.
  Each replica answers for itself, so the harness calls through the edge until it has seen every
  instance id — which the round-robin above makes deterministic — rather than reaching into
  containers with `docker exec`.
- **The generator is Node, not k6 (deviates from ADR-P03).** k6 is not installed on this machine
  and would be a binary to install before the scripts run; the artefact the ask names is JSON,
  which is what a Node script produces natively. The generator is ~90 lines of `fetch` in a closed
  loop and reports its own CPU utilisation, so a run where the generator was the ceiling is
  visible in the same file as the run.
- **The PDF reads the JSON and nothing else.** `report.mjs` takes a results file and renders the
  tables and charts from its fields; a figure with no field prints `—`. Re-running the report on
  an old file reproduces that report exactly.

**Skipped, deliberately:**

- **The live-interview scenario, and with it the SSE ceiling.** Every open stream holds its own
  `redis.duplicate()` (`sse.ts:180`) and `MAX_STREAMS_PER_USER` is per process, so the scenario
  needs a population of users, which needs registration, which is capped at 3/hour/IP by design.
  Seeding users straight into Postgres would measure a path no candidate takes. P03/P04 own that
  scenario and own the ceiling; this ledger measures the ordinary request path and says so.
- **Write paths under load.** Every state-changing route is rate-limited per user or per IP — that
  is the product working. A load test that disabled those limits would be measuring a build nobody
  ships. `POST /auth/login` is measured once, as the run's own sign-in.
- **Per-request database timing.** It would mean wrapping the shared `prisma` client in
  `$extends` and re-typing every call site for a number Postgres already keeps:
  `pg_stat_database`'s `xact_commit` and `tup_returned` are read before and after every run and
  the deltas are in the JSON.
- **Repeats, warm-up sweeps and confidence intervals.** One run per cell, 12 seconds each, 3
  seconds of discarded warm-up. The variance is not characterised, and the report says so rather
  than implying a precision the method does not have.
