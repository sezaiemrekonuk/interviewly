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
