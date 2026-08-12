# Turn-taking — Decisions (append-only ADR log)

Never edit past entries. Supersede with a new dated entry referencing the one it changes.
Prefix `ADR-T` to avoid collision with foundations (`ADR-F`), auth (`ADR-A`), interview-core
(`ADR-I`), adaptive (`ADR-D`), speech (`ADR-S`), voice (`ADR-V`), conductor (`ADR-C`) and every
other ledger.

The ledger exists because of one complaint that no existing ledger owned: *the interviewer cuts
me off while I am thinking.* Not a bug in any of them — the VAD fires exactly as ADR-S06
specified, the STT transcribes what it was given, the conductor answers the utterance it
received. The mistake is upstream of all three: two seconds of silence was treated as the end of
a turn, and it is not. It is the end of a *sentence*, sometimes not even that.

---

## ADR-T01 — 2026-08-10 — Silence stops the recorder; a model decides whether the turn is over

**Context:** ADR-S06 made acoustic silence the turn-end signal: ~2 s below the RMS threshold
stops the recorder, and `onstop` uploads and submits. Its own Open question 2 called the window
"a guess until heard, which is why the manual stop is always visible." Heard, it is wrong in a
way tuning cannot fix. Lengthen the window and a finished answer sits in dead air; shorten it and
a thinker is interrupted sooner. The signal itself carries no information about whether the
speaker was done — only about whether they were audible.

Three options: (A) raise the window and accept the dead air; (B) keep the window, transcribe on
silence, and let a cheap model decide whether the utterance sounds finished, holding it if not;
(C) move to streaming STT with provider-side semantic turn detection.

**Decision:** (B). `VAD_SILENCE_MS` stays at 2 000 — with a gate behind it, a short window costs
nothing but a round trip, and a long one is pure latency on every finished answer. The recorder
stopping and the turn ending become two different events. A fragment the gate calls unfinished is
held, the mic reopens, and the candidate is not told anything happened.

Two ceilings make this safe rather than open-ended: 13 s of continuous silence ends the turn
whatever the gate thinks, and a gate that cannot answer forwards rather than holds.

**Why not (A):** It trades one bad interruption for guaranteed dead air on every single answer,
and it still cuts off anyone who pauses longer than the new window. The failure does not go away;
it gets rarer and slower.

**Why not (C):** It is a different architecture, and the one ADR-S01 deliberately walked away
from. Streaming would make this gate unnecessary, which is an argument for revisiting it later
and not for coupling this fix to it.

**Consequences:** A turn can now cost more than one STT call — one per pause. Total audio
seconds are unchanged, so the marginal cost is one nano call per pause (~200 input tokens). The
`SPEECH_STT_TRANSCRIBED` log line now fires once per fragment rather than once per turn, which
is the truth about what was billed. Supersedes ADR-S06's silence rule; ADR-S06 otherwise stands.

---

## ADR-T02 — 2026-08-10 — The unfinished fragment is held in Redis, not on the client

**Context:** Something must hold the earlier fragments while the candidate keeps talking. The
obvious cheap answer is the client: it already has the text (the route can echo it back), and
sending it up with the next fragment needs no store, no TTL and no cleanup.

ADR-C01 explicitly rejected Redis for the conversation, and its reasoning has to be answered
rather than ignored: *"The conversation is not a cache. Losing it loses the interview... Redis
in this system is a fan-out and a rate-limit store; nothing durable lives there."*

**Decision:** Redis, `interview:{id}:pending-turn`, `{ text, questionId, probes }`, TTL 300 s,
consumed by an atomic `MULTI GET + DEL`.

ADR-C01's argument is about **durability**, and it still holds unamended: nothing durable lives
in Redis, and this is not durable. A held partial is a scratch value with a lifetime measured in
seconds, belonging to one unfinished turn. Losing it costs half a sentence the candidate is still
in the middle of saying, and they say it again. Nothing is reconstructed from it hours later, no
worker reads it, and the report has never heard of it. The moment it becomes an utterance it
becomes a `chat_messages` row — written by the same path ADR-C01 specified, before anything is
spoken. So this is an exception to *where scratch state may live*, not to *what the conversation
is*.

**Why not the client:** because the field would have to come back up, and that turns
`POST /turns/audio` — the **voice** route — into one that accepts candidate-supplied text. Voice
transcripts are provider output by construction today. A `pending` field on the wire lets a
candidate post words they never spoke into the utterance the conductor answers, the transcript
records and the report scores, while paying for a fraction of a second of audio. Refresh-survival
is the smaller half of this decision; the trust boundary is the reason.

The same reasoning puts the loop counters in the stored value. `probes` and the length cap are
what stop a client from holding a turn open forever, and neither is defensible if the client is
the one counting.

**Consequences:** One new Redis key class and a `pending-turn.ts` module over the shared
connection from `auth/rate-limit.ts` — never a second connection. `takePendingTurn` is
read-and-delete because two uploads racing must not both consume the same partial. A partial
whose stored `questionId` no longer matches the current question row is discarded rather than
joined. No hook in `applyTransition`: every reader already requires `hr_round`/`tech_round` and a
matching question, so a stale buffer on an ended interview is unreachable and its TTL collects
it. If Redis is unreachable the fragment is gated alone and forwarded — degraded, never stuck.

---

## ADR-T03 — 2026-08-10 — The gate is nano, chainless, and fails open

**Context:** The gate sits between the candidate's last word and the interviewer's first, in
front of a `conductTurn` that already has a 10 s timeout. Its latency is additive on every
finished answer — the common case — for a decision that is a single boolean.

**Decision:** `interview.turn.complete` v1, `openai/gpt-4.1-nano`, `temperature 0`,
`max_tokens 30`, `TIMEOUT_MS.turnComplete = 3_000`, **no tier-2 fallback step**, and any failure
whatsoever — throw, timeout, malformed output, `BudgetExceeded` — is read as `finished: true`.

`gpt-4.1-nano` because the precedent exists (`interview.title.generate`) and because the task is
sentence-completion, not judgement. Chainless because `buildChain` appends `gemini-2.5-flash` to
every chain, and a retry here costs a 3 s timeout *plus* a full second attempt before the
candidate hears anything — for a value we already know how to default. Fail-open because the
failure mode of a dead gate must be today's product, not a broken one: forwarding an unfinished
utterance is exactly what ships today, while holding one nobody will ever release is a candidate
sitting in silence.

**What the gate is asked** is *"has this speaker finished a thought"*, not *"have they answered
the question"*. A refusal, a counter-question, a one-word reply and an off-topic reply are all
finished utterances and belong to the conductor, which was built to handle them (C02). A gate
that judged answer-quality would hold exactly the turns where the interviewer most needs to
speak — the candidate who says "I don't know" would be met with silence.

**Consequences:** One prompt, one schema, one seam method, one stub branch. The gate is the first
prompt in the repo to opt out of the fallback chain, which is a small special case in
`live-client.ts` and is documented there. Its verdicts are logged against fragment length so the
error rate on Turkish — spec Open question 1 — is measurable rather than argued about.

---

## ADR-T04 — 2026-08-10 — Thirteen seconds of silence is a turn the conductor takes

**Context:** With a gate in the loop, a candidate who says nothing at all never triggers
anything: the VAD never arms, no fragment is uploaded, and the room waits forever. Something has
to end that. The cheap version is a client-side jump to the next question.

**Decision:** After 13 s of continuous silence the room sends one signal —
`POST /turns { kind: 'silence' }` — and the **server** decides what it means. With a held partial
for the current question, it is conducted as an ordinary utterance carrying that text. With
nothing held, it writes a `role: 'system'`, `action: 'silence'` row and runs a normal conductor
turn, so the interviewer chooses between nudging and moving on.

The clock is anchored to the last loud frame, or to the moment the mic opened if nothing was ever
heard. Probe round-trips do not extend the candidate's patience budget.

**Why not a client-side advance:** C02 made pacing the interviewer's decision, and "the candidate
went quiet" is pacing information of exactly the kind it was given the floor for. A room that
skipped to the next question would also be the room asserting interview state, which K11 forbids.

**Consequences:** Silence rows must be counted by both the whole-interview `CONDUCTOR_MAX_TURNS`
backstop and the per-question ceiling; otherwise a candidate who stays silent loops with the
interviewer nudging forever. Counting them means the existing forced-`drift` clamp advances the
question after `CONDUCTOR_MAX_TURNS_PER_QUESTION` combined turns — no new ceiling and no new
config. They stay out of `answerWindow`, which filters `role === 'user'`, so nothing scores a
silence. They are hidden from the room for the same reason refusals are: the note is written for
the interviewer, and rendering "the candidate has said nothing for 13 seconds" back at a person
who is struggling is the room narrating their failure to them.

---

## ADR-T05 — 2026-08-10 — The room shows the held partial only after a reload, and never updates it

**Context:** With the partial held server-side, a reload mid-thought recovers it — but the
remounted room does not know it exists. The candidate re-answers from scratch and their second
attempt is joined onto their first. Three treatments were mocked against the real conversation
component: a live provisional line that grows per probe; a status line with no text; a notice
shown once on mount.

**Decision:** The notice, shown on mount only, with its text **frozen** at the mounted value, and
removed when the turn is conducted. Plus one static line acknowledging the pause while the
recorder is listening and something is held.

**Why not the live provisional line:** two costs, both real. It puts raw, unedited Scribe output
on screen mid-answer — a *misheard* version of the candidate's own words that they have no way to
correct — and it changes on a timer inside a list that carries `aria-live="polite"`, which is the
only way a screen-reader user meets the interviewer's words at all. A line that regrows on every
probe re-announces itself every time.

**Why not the status line alone:** it leaves the reload case exactly where it started. The
candidate cannot see what is held, so they repeat it, and the repeat is prepended — the precise
duplication the server-side buffer exists to prevent.

**Why frozen:** the notice means *this is what survived the reload*, not *this is what the server
holds now*. A card that grew with each probe would be the live provisional line wearing this
one's clothes, live-region problem included.

**Consequences:** `GET /state` must surface `pendingTurn` only when its stored `questionId`
matches the current question row — otherwise a reload can show a half-sentence belonging to a
question two turns back — and must read it with a plain `GET`, never the consuming take: two
refreshes must show the same text, and a polling client must not be able to eat its own answer.
The room reads it once into a ref so later refetches cannot rewrite it. The tail of a long
partial is shown, front elided, because what the candidate needs is the sentence they were in the
middle of, not the start of a thought they finished minutes ago.

---

## ADR-T06 — 2026-08-11 — Two clocks: 4 s to flush a held fragment, 13 s to break a silence (supersedes ADR-T04's single window)

**Context:** The first live run, measured. Four uploads, three `CONDUCTOR_TURN_HELD` (134, 111
and 142 characters — ordinary finished answers). ADR-T04 gave the room one window for two
different situations, and on a wrong hold the 13 s clock is the only exit, so a finished answer
cost ~16 s of silence. PLAN.md said these numbers move "when someone hears them being wrong";
the owner heard it on the first try.

**Decision:** The threshold depends on whether the server is already holding a fragment.
`FLUSH_HELD_MS = 4_000` when it is; `FORCE_SUBMIT_MS = 13_000` when nothing was said. Same
anchor, same guards, same `POST /turns { kind: 'silence' }` — the room still asserts nothing.
Paired with prompt `interview.turn.complete` **v2**, which leads with the finished default
instead of cataloguing what unfinished looks like.

**Why not one shorter window:** 13 s is a thinking budget for a candidate staring at a hard
question, and it is not what was wrong. Shortening it globally would cut off the people the
whole ledger exists to protect.

**Why not the prompt alone:** the gate will still be wrong sometimes, and the cost of being
wrong is what a candidate actually experiences. Cheapen the failure and reduce it.

**Consequences:** ADR-T04's "13 s" and its Consequences hold for the silence branch and were
true when written; only the held branch is superseded. Two clocks is two chances to break *the
turn always ends*, which is why T05 is opus-tier and why its tests assert both branches fire
exactly once. The gate's real grace after a verdict is ~3 s, not 4 — the round trip is inside
the window.

---

## ADR-T07 — 2026-08-12 — The VAD arms against the room's own noise floor, not a fixed level (supersedes ADR-S06's threshold)

**Context:** Four live runs, no `SPEECH_STT_TRANSCRIBED` in any of them. The owner confirmed the
Stop button was visible (recorder open) and that their own mic bars moved (meter alive) — so
`mic.level` was non-zero and never once reached `VAD_THRESHOLD = 0.05`. 0.05 RMS is a loud voice
on a close microphone; a laptop mic at arm's length runs an order of magnitude quieter. The room
was listening to a candidate who was talking and refusing to call it speech, so nothing was
uploaded, nothing was held, and the only thing that ended a turn was the 13 s clock.

**Decision:** Arm on `min(VAD_THRESHOLD, max(floor × 3, 0.01))`, where `floor` is the quietest
level measured since this recorder opened. The fixed threshold becomes a **ceiling**: the rule is
never less sensitive than before, and on a quiet microphone it is far more so. The floor is reset
per recording and only ever moves down within one, so a room that gets noisier mid-answer cannot
desensitise the rest of it. A level of exactly 0 never teaches the floor anything — that is a
microphone delivering nothing, not a measurement of the room.

**Why not just lower the number:** the same guess, one order of magnitude down, and wrong for the
next microphone in the other direction. Three times the measured floor is the standard margin and
needs no knowledge of the hardware.

**Consequences:** Over-sensitivity degrades safely — a room whose tone sits above the bar keeps
refreshing `lastLoud`, so the VAD simply never fires and the clock ends the turn, which is
exactly today's behaviour and no worse. ADR-S06's threshold and `VAD_THRESHOLD`'s value are
unchanged as written; what changed is that the value is now a bound rather than the test.
`speech-latency` `L03` still owns `VAD_SILENCE_MS`.
