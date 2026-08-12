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
