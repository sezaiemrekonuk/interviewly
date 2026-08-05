# Frontend — Decisions (append-only ADR log)

Never edit past entries. Supersede with a new dated entry referencing the one it changes.
Prefix `ADR-W` to avoid collision with foundations (`ADR-F`), auth (`ADR-A`), interview-core
(`ADR-I`), report (`ADR-R`), admin (`ADR-N`), voice (`ADR-V`), adaptive (`ADR-D`). Referenced
back into `PLAN.md`.

---

## ADR-W01 — 2026-08-03 — Server state is React Query; there is no Redux

**Context:** Almost every value a screen shows is server state (the `/me` payload, room state,
the report, the history list, the admin metrics). Options: (A) React Query with endpoint-shaped
query keys; (B) Redux/RTK; (C) hand-rolled `useEffect` + `useState` fetching per screen.

**Decision:** React Query (A), K11. Query keys are stable and endpoint-shaped:
`['me']`, `['me','profile']`, `['me','interviews',{cursor}]`, `['interview',id,'state']`,
`['interview',id]`, `['admin','interviews',filters]`, `['admin','stats',filters]`.
`['interview',id,'state']` is the **single source of room truth**. Real client state — the
locale, the in-room lifecycle phase, which text is mid-animation, whether the transcript panel
is collapsed — is `useState`/context only. List endpoints are cursor-paginated (`nextCursor`);
the client never assumes a page count.

**Why not Redux:** The spec forbids it (K11). A global mutable store for data the server already
owns invites two screens disagreeing about the same fact — exactly what the single-source-of-truth
query key prevents.

**Why not per-screen `useEffect`:** No caching, no invalidation story, no dedup — the SSE
nudge-then-refetch pattern (ADR-W02) needs one cache to invalidate, which is what React Query is.

**Consequences:** W02 builds the `QueryClient`, the provider, and the query-key factory
(`lib/query.ts`); every later task consumes it. `@tanstack/react-query` is added as a dependency
in W02.

---

## ADR-W02 — 2026-08-03 — SSE is native `EventSource`, nudge-then-refetch, on the real route

**Context:** The room stays live via server-sent events. The frontend spec route map names
`GET /events/interviews/:id`, but the backend actually mounts the stream at
`GET /interviews/:id/events` (`backend/modules/interview/router.ts:33`, `sse.ts:40`). Options:
(A) native `EventSource` against the implemented path, treating every event as a content-free
nudge; (B) parse and render the event payload; (C) a WebSocket/`Last-Event-ID` replay protocol.

**Decision:** (A). One `EventSource` per open room on `GET /interviews/:id/events`. Events are
`{ type }` only and the payload is **ignored beyond its arrival**: on any event → invalidate
`['interview',id,'state']`; on `error`/disconnect → the browser's native reconnect runs; on
`open` → one invalidation to catch anything missed. No `Last-Event-ID`, no ordering assumption,
no replay handling — the refetch is idempotent (K11, §11.2). The **real path wins over the spec's
route map**; the spec is stale on this one line.

**Why not render the payload:** Rendering from an SSE body makes the client hold room truth the
server owns, and the same event delivered twice would double-apply. The refetch is the barrier.

**Why not WebSocket/replay:** The backend implements EventSource; a replay protocol is complexity
for a stream whose every message means the same thing ("refetch").

**Consequences:** W02 builds `lib/use-interview-events.ts`; W06/W07/W09/W10 consume it. Tests mock
`EventSource` (ADR-W04). The stale spec line is recorded here so a future reader does not "fix"
the working path to match the map.

---

## ADR-W03 — 2026-08-03 — The `ui` build/seed checks live in W01, not a separate `ui` ledger

**Context:** The `ui` spec's 17 ACs are verified as build/seed checks (token lint, computed
AA-contrast including each gradient stop, avatar-set and mascot-set completeness/budget/content-hash
validation, the gradient route-list check, the shadow-tier check) — `COVERAGE.md` §`ui`. F01
shipped the tokens and the type unions; F02's seed uploads the avatar/mascot objects. No task
owns the *verification*. Options: (A) fold the checks into the frontend ledger's first task;
(B) create a one-task `ui` ledger.

**Decision:** (A), per prompt §2. W01 is a Vitest suite that fails before the checks exist and
covers all six check families. A `ui` ledger would be one build-check task wrapped in a PLAN,
STATE, DECISIONS, REFERENCE, MODELS and EXECUTION_PROMPT — ceremony with no second task to
justify it.

**Consequences:** W01 has no runtime dependency (F01/F02 only) and can run first. The `ui` spec
is treated as an input to W01, not a ledger to be created.

---

## ADR-W04 — 2026-08-03 — Verification is Vitest + RTL and Playwright smokes, never Cucumber

**Context:** How does a frontend task prove itself? The repo's acceptance ring is Cucumber over
the HTTP API with a stubbed AI module — a browser is out of that ring (`COVERAGE.md`: all 26
frontend + 17 ui ACs out-of-ring). Options: (A) Vitest + React Testing Library over a mocked API
and a mocked `EventSource`, plus a handful of Playwright smokes against the composed stack;
(B) add frontend `.feature` files to `cucumber.js`.

**Decision:** (A). The repo already has `frontend/vitest.config.mts` (jsdom, `renderWithIntl`
harness, `stubFetch` pattern — see `src/app/(auth)/sign-in/page.test.tsx`) and root
`@playwright/test` (`playwright.config.ts`, `tests/smoke`). Every task's `## Verification` is a
runnable `npm run -w frontend test …` (or a Playwright smoke) that fails before the work exists.

**Why not Cucumber:** Cucumber drives the API, not the DOM. A frontend `.feature` would either
duplicate a backend scenario or assert something Cucumber structurally cannot observe.
**`cucumber.js` is never edited by this ledger** (prompt §5).

**Consequences:** Task verification commands use `vitest` file/name filters, not `--tags`. The
mocked-`EventSource` seam is a W02 test util reused by W06/W07/W10.

---

## ADR-W05 — 2026-08-03 — Every screen ships English + Turkish from day one

**Context:** `next-intl` and `messages/{en,tr}.json` already assume two locales; F01 seeded the
whole `errors.*` namespace in both. Options: (A) author `en` + `tr` keys for every new screen
namespace as it is built; (B) English-only, leaving `tr.json` a stub to backfill.

**Decision:** (A), owner decision. `messages/en.json` is the source; `tr.json` mirrors its keys
exactly (a missing key is a build/lint failure, not a silent English fallback). Each task adds its
own screen namespace (`landing.*`, `onboarding.*`, `setup.*`, `room.*`, `report.*`, `dashboard.*`,
`admin.*`, `prejoin.*`, plus `mascot.*` for pose `alt`). LLM-generated content — questions, report
prose, transcript — is **content, not UI**: rendered in the interview language (§3.4), never routed
through `next-intl`, never interpreted as HTML.

**Consequences:** Every screen task's steps include both locale files. The locale toggle (W02)
changes UI copy and `errors.*` only; it never touches `interviews.language`.

---

## ADR-W06 — 2026-08-03 — The abandoned sweeper is report R04; voice is a real gated phase

**Context:** Two things the frontend ledger must *not* absorb. (1) The 24 h `abandoned` sweeper —
`EndedReason.abandoned` exists and admin stats count it, but nothing writes it. (2) The voice room
— the final demo uses voice, but it is gated on the voice ledger (V02/V05).

**Decision:** (1) The sweeper is a BullMQ repeatable job in the existing `worker/src/index.ts`,
appended to the **report** ledger as **R04** (prompt §6.2), not planned here. (2) The voice phase
(W09–W10) is a real, numbered part of this ledger — not cut — but every voice task depends on the
voice ledger, and text mode (W06) is sequenced first so a working end-to-end demo exists before
voice lands.

**Why text-first:** If the deadline squeezes, the demo still closes on the text path (land → …→
report). Voice is additive, not the spine.

**Consequences:** No `worker` ledger is created. W09 depends on V02; W10 depends on V02/V05. The
report ledger gains R04 via the `update-initiative` skill in this same planning session.

---

## ADR-W07 — 2026-08-03 — W07 depends on R01 for the report read; the GET handler is a flagged gap

**Context:** The report screen (W07) reads `GET /interviews/:id` → `{ interview, transcript,
report? }` (frontend spec route map; backend spec line 107). But **no task builds that handler** —
R01's Definition of Done *assumes* it ("`GET /interviews/:id` returns the ready report",
`report/tasks/R01-worker-report-consumer.md:127`), yet the interview router
(`backend/modules/interview/router.ts`) has no `GET /:id` route and R01's steps do not add one.
Options: (A) depend W07 on R01 and record the handler-ownership gap as a blocker; (B) invent a
frontend assumption about where the read lives; (C) plan a backend task here.

**Decision:** (A), prompt §5. W07's `Depends on` is **R01** — the task that makes the ready report
fetchable end-to-end. The missing handler is recorded in STATE.md's "Open blockers" so it is
chased in the report or interview-core ledger, not silently coded against. This ledger builds no
backend route (C is out of scope), and never guesses a shape (B).

**Consequences:** W07 is buildable against the documented `{ interview, transcript, report? }`
shape once R01 is green; if R01 lands without the `GET /interviews/:id` handler, W07's verification
(mocked API) still passes but the composed Playwright smoke will 404 — the blocker note tells the
executor to confirm the handler exists before claiming the demo path closed.

## ADR-W06 — 2026-08-04 — room-state gains `personas`, `persona.id` and `transcript` rather than the room guessing them

**Context:** W06 must render two tiles (only one live), content-addressed avatars
(`personas/{id}/{state}-{sha}.webp`) and the answered turns — all "from `GET /interviews/:id/state`"
(K11). The shipped payload carried none of it: `persona` had no `id`, there was no round list, and
`transcriptCursor` is a count with no rows. Options: (A) derive client-side (guess `seed-persona-hr`,
guess the sha, invent the second tile); (B) block W06 on an interview-core task; (C) extend the I03
handler, additively, in this task.

**Decision:** (C). `state.ts` now returns `persona.id`, `personas[]` (both rounds, hr→tech, each with
its `avatar_set`) and `transcript[]` (answered turns, global order). Additive only — every existing
field, including `transcriptCursor`, is untouched, so I03/I06 acceptance steps still hold.
(A) makes the room render identities the server never named — the exact K11/K2 failure this layer
exists to prevent, and a wrong sha is a broken tile in the one screen that must not flicker.
(B) stalls the demo spine for a payload gap the same owner (Sezai) holds anyway.

**Consequences:** interview-core REFERENCE room-state shape updated. W07 can reuse `transcript`
until R01's `GET /interviews/:id` grows its own. The whole transcript ships on every refetch —
`ponytail:` comment in `state.ts` names the paging upgrade if turn counts grow.

## ADR-W08 — 2026-08-05 — the report screen reads two endpoints, and the SSE nudge invalidates the `['interview',id]` prefix

**Context:** `GET /interviews/:id` shipped (R01, `backend/modules/interview/get.ts`) but returns
`{ interviewId, state, report }` only — no `transcript`, no `endedReason`, both required by W07's
DoD (transcript render, cut-short header). Options: (A) extend `get.ts` from this ledger; (B) read
transcript/`endedReason` from room-state, which already derives both (ADR-W06); (C) block W07.

**Decision:** (B). `/interviews/:id` for the payload, `/interviews/:id/state` for
transcript + `endedReason`. (A) is another ledger's file and would put a second copy of `state.ts`'s
hr→tech ordering in it; (C) stalls the screen that closes the demo path for a gap already covered.
Consequence: `useInterviewEvents` now invalidates `queryKeys.interview(id)` — the **prefix** of both
`['interview',id]` and `['interview',id,'state']` — instead of the state key, so one nudge refreshes
a screen that mounts both. Supersedes ADR-W02's key, not its nudge-then-refetch rule.

**Consequences:** two reads per report render (both cached, both nudged together). If `get.ts` ever
grows `transcript`/`endedReason`, drop the state read here — not the reverse.
