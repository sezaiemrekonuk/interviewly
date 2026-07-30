# User Stories — Interviewly

**Status:** review draft. Reorganised from the original arrow-flow draft, the candidate
story list collected from the case brief, and the meeting blockers of 2026-07-29.

**Authority:** `IDEA.md` is the parent document. Where a story here conflicted with it, the
story was rewritten, not kept — the rulings are listed in §D so nothing looks like an
oversight. Anything that survives review graduates into `.agents/specs/*.md` and then into
`.agents/features/*.feature`.

**Format:** `US-nn` — a permanent ID. One story statement, then the flow that satisfies it,
then the `IDEA.md` sections it binds to. IDs are never renumbered.

**Language:** authored in English (IDEA.md language policy). The product ships English UI
with Turkish selectable; the interview language is a separate axis (§3.4).

---

## A. Candidate stories

### A1. Account and access

**US-01 — Sign in with email or Google**
As a candidate, I want to sign in with my email and password or with my Google account, so
that I can reach the system quickly and safely.
→ Landing CTA routes to sign-in → email/password or Google (Authorization Code + PKCE) →
session cookie → **where I belong**: onboarding if I have not done it, the setup screen if I have no
interviews yet, otherwise my history (K8.7).
*Binds:* K8, K8.5, K8.7. *Note:* no anonymous interviews — sign-in always precedes setup. The
destination is decided from one server answer, so two screens can never disagree about it.

**US-02 — Register in under a minute**
As a new candidate, I want to create an account with just an email and a password, so that
nothing stands between me and my first interview.
→ `POST /auth/register`, password ≥ 10 characters → signed in immediately → a verification mail is
sent and prompted, but nothing blocks on it.
*Binds:* K8.5, K8.6. *Revised 2026-07-30:* email verification and password reset are **in scope**
(K8.6), reversing the earlier cut. Verification never gates sign-in — enforcement is one flag on
`POST /interviews`, shipped off — so registering and interviewing still costs one screen.

**US-02a — Confirm my email address**
As a candidate, I want to confirm my address from a link in my inbox, so that the account is
demonstrably mine and recoverable.
→ `/verify-email` shows a pending state with a 60-second resend countdown → the link consumes a
single-use token → verified.
*Binds:* K8.6. *Note:* the link works once. A second click says so and offers a new one.

**US-02b — Get back into my account**
As a candidate who forgot my password, I want to reset it from my email, so that a forgotten
password is not a lost history.
→ `/forgot-password` → identical confirmation whether or not the address has an account → the
tokened form sets a new password (≥ 10 characters) → **every existing session is signed out**.
*Binds:* K8.6. *Note:* a Google-only account uses this same flow to set its first password.

**US-02c — Tell the system who I am, once**
As a new candidate, I want to answer a few things about myself right after signing up and upload my
CV, so that every interview I ever run is already personalised.
→ Three cards (identity · education · interests), each saved on its own, **Skip for now** on every
card, optional CV PDF → stored on my account → bound into question *and* report generation.
*Binds:* §3.3 layer 1, K8.7, K12. *Note:* closing the browser mid-flow loses nothing — the next
sign-in resumes on the card I left. My date of birth is collected but never sent to the interviewer
AI (§3.3), and the form says so.

**US-03 — Google sign-in links to my existing account**
As a candidate who registered with a password, I want a later Google sign-in on the same
email to land in the same account, so that I don't end up with two histories.
→ Google returns `email_verified: true` → accounts link. Otherwise rejected with
`ACCOUNT_LINK_REQUIRES_PASSWORD`.
*Binds:* K8.5.

### A2. Setting up an interview

**US-04 — Paste or upload the job listing**
As a candidate, I want to paste the listing text of the position I'm applying for or upload
it as a PDF, so that the questions are prepared for that specific listing.
→ Setup screen: **one big text box** carries the screen (paste), with *Upload listing PDF*
(≤ 10 MB, ≤ 30 pages) as a secondary action → text extracted. Suggestion chips prefill common
roles; *Try a sample listing* loads a seeded one so I can start with nothing of my own.
*Binds:* K12, §3.1, §4.3.1. *Note:* a scanned PDF that yields under 200 characters asks the
candidate to paste the text instead. No OCR. **There is no "import from a URL"** — it is an SSRF
surface with no requirement behind it (§4.3.1), and the text box already does the job.

**US-05 — See and correct what the system understood**
As a candidate, I want the lobby to show me the detected occupation, the interview language
and the question split before I commit, so that a wrong guess doesn't ruin the interview.
→ Lobby shows `Backend Developer · Turkish · 3 HR + 5 technical` → occupation and language
are both editable → Join.
*Binds:* §3.4, §3.7, §15.2 (story 3 ruling: editable summary adopted).

**US-06 — Choose how long the interview should be**
As a candidate, I want to set a target question count, so that the session fits the time I
actually have.
→ Slider/select of N → split shown as `hr = max(2, round(N * 0.4))`, `tech = N - hr`.
*Binds:* K5, §3.7. *Note:* N is a **ceiling, not a quota** — see US-14 and §C.

**US-07 — Answer 2-3 short profile questions**
As a candidate, I want to answer a couple of short questions about my experience before the
interview starts, so that the questions reflect who I am rather than the listing alone.
→ Setup-screen form: years of experience, areas of interest, target seniority → **merged with my
account profile and CV (US-02c) into `candidate_profile` as a snapshot** → bound into every
generation prompt.
*Binds:* §3.3. *Note:* skippable; skipping sends an explicit "no profile provided" marker. This
per-interview form is **not** replaced by the account onboarding — the brief's bonus is worded
"before moving to the interview questions", and these are the role-specific answers the account
profile cannot know. The merge is snapshotted at setup, so editing my profile later never rewrites
an older report's inputs.

**US-08 — Wait seconds, not minutes**
As a candidate, I want the position-specific questions to be ready within a few seconds, so
that I can start practising without waiting.
→ "Waiting for the host to accept your join request" screen covers the HR batch generation
(< 8 s budget) → the technical batch generates during the HR round, so the handover is
never a loading screen.
*Binds:* §3.7, §8.1.

**US-09 — Check my mic and camera first (voice mode)**
As a candidate, I want to see my camera preview and mic level before joining, so that I'm
not fighting my devices in front of an interviewer.
→ **A pre-join screen of its own** (`/interviews/:id/pre-join`) shows preview + level bar → camera
toggle (**off by default**) → a note states the camera image never leaves the browser and nothing is
recorded → "Join" → room opens with exactly the device state chosen.
*Binds:* §3.2, §4.3, §14. *Note:* text mode has no device check and no self-tile. The check runs
**before** a voice session is minted, so denying the microphone drops me into text mode without
having spent anything — landing in a broken room is the failure this screen exists to prevent.

### A3. Inside the interview room

**US-10 — Meet a warm HR interviewer first**
As a candidate, I want the opening, easier questions to come from a warm, reassuring HR
interviewer with a voice and a face, so that I can settle into the interview.
→ Room opens → HR persona (name, voice, avatar, system prompt all from the `personas`
table) greets and explains the format → asks question 1.
*Binds:* §3.1, §3.6.

**US-11 — Meet a second, more formal interviewer for the hard part**
As a candidate, I want the technical/competency questions to come from a different, more
formal interviewer, so that the panel feels like a real one.
→ HR questions exhausted → "HR round completed, connecting you to the technical
interviewer" interstitial → second persona takes over.
*Binds:* §3.1, §15.2 (story 6 ruling: interstitial adopted). *Note:* for non-engineering
listings this round is a **competency** round, driven by the occupation cluster, not a tech
stack.

**US-12 — See who I'm talking to**
As a candidate, I want to see both interviewers on the call and know without thinking which one is
speaking to me right now, so that a two-person panel does not feel like a mess.
→ **Both persona tiles are on screen the whole time.** The round's interviewer is the active
speaker: full opacity, a green ring, name and role lit. The other is dimmed and labelled *up next*
or *done*. The handover shows an interstitial, moves the ring, and announces itself to screen
readers. The current question stays in a banner that never scrolls away.
*Binds:* §3.2, §3.6, §4.3. *Note:* avatars are **5 static images per persona**
(`idle | listening | thinking | speaking | acknowledging`), not video loops. Only one agent ever
holds the turn — the rounds are sequential and the server has exactly one live question, so there is
no cross-talk to untangle. The room shows a `LIVE` badge and **no `REC` badge**, because nothing is
recorded (§3.2).

**US-13 — Know where I am**
As a candidate, I want a clear progress indicator such as "3 / 8", so that I know how much
is left.
→ Dot bar + counter driven by `current_index` (global, 1..N across both rounds).
*Binds:* K2. *Note:* N is the target; if the interview is wrapped up early the indicator
reflects that (US-14).

**US-14 — Be wrapped up early when it isn't going anywhere**
As a candidate, I want the interviewer to take the initiative and close the interview early
when I clearly cannot answer, so that I'm not marched through five more questions I'll fail
the same way.
→ Repeated unanswerable/empty answers → the interviewer closes with a short, non-punitive
note → `ended_reason = 'cut_short'` → the report explains why it ended early.
*Binds:* K5, K2 (`cut_short`), §C blocker 1 and 4. *Note:* the interview is **never
extended** past N.

**US-15 — Answer by speaking, or by typing**
As a candidate, I want to speak my answer, and to type it instead when speaking isn't
possible, so that the interview works whatever my setup is.
→ Voice mode: live transcript on the right shows what was understood → "finish answer".
Text mode: the question types itself in, the answer goes in a text box → "Submit answer".
*Binds:* §3.2, §3.8. *Note:* text mode is the MVP mode and is not a degraded skin — same
room, animated avatar, same conversation panel.

**US-16 — Answer non-speakable questions on screen**
As a candidate, I want multiple choice, ordering and short code/SQL questions rendered as a
widget, so that I don't have to dictate a query out loud.
→ Question `kind` marks it → widget panel opens → mic muted in voice mode → submit → stored
as an answer with `input_mode = 'widget'`, exactly like a spoken one.
*Binds:* §3.9.

**US-17 — Not be able to skip or go back**
As a candidate, I want to be unable to return to a passed question or skip ahead, so that I
feel real interview pressure.
→ Server-side state machine; an out-of-turn submission is rejected with
`QUESTION_NOT_CURRENT` and the interview stays where it was.
*Binds:* K2, `features/interview_flow.feature`. *Note:* enforced on the server, not by
hiding a button — `curl` is the actual threat.

**US-18 — Be interviewed in my own language**
As a candidate, I want the interview to run in the language of the listing, and to follow me
if I switch, so that I practise in the language I'll be interviewed in.
→ Language auto-detected at setup, overridable in the lobby → two consecutive answers in
another language switch `interviews.language` and the persona continues there.
*Binds:* §3.4.

**US-19 — Leave the room and come back**
As a candidate, I want to close the tab or drop off and rejoin where I left off, so that a
dead battery doesn't cost me the whole interview.
→ Dashboard shows "in progress — continue" → rejoin at the current question, previous
answers intact → 24 h of no activity turns it into `abandoned`.
*Binds:* K2, K11 (nudge-then-refetch makes resume fall out for free), §C blocker 3.

**US-20 — Survive a voice failure**
As a candidate, I want the interview to continue in writing when the voice connection dies,
so that I don't lose what I've already answered.
→ "Voice connection lost, continuing in text" → same question, text box → mode becomes
`text` → answers preserved → the report notes the mode change.
*Binds:* §3.2, K3, `features/voice_fallback.feature`. *Note:* downgrade only. Text never
upgrades back to voice mid-interview.

### A4. After the interview

**US-21 — Get a reasoned report**
As a candidate, I want a short "evaluating" wait and then a report covering my overall
impression, my strengths and what I need to improve, so that I can act on it.
→ Last answer → `evaluating` → queued report job → SSE nudge → report page: overall
impression + score, strengths, improvements, per-round evaluation, per-question score with
the reason for that score, answer duration, STAR adherence.
*Binds:* K15, K10, §8.1 (< 60 s). *Note:* a weak HR round **never** eliminates the
candidate — the round carries a note and the interview continues.

**US-22 — Keep my reports**
As a candidate, I want completed interviews and their reports kept in my history, so that I
can reread them later.
→ `/me/interviews` lists occupation, date, duration, state, score → open one → report +
transcript.
*Binds:* §13 of the original draft, K13. *Note:* "the recording" in the source document
means **the transcript**. No audio or video is ever recorded (§3.2).

**US-23 — Delete an interview I don't want**
As a candidate, I want to remove an interview from my history, so that the list stays tidy.
→ Delete → gone from my list immediately → soft-deleted, still visible to admin with a
`deleted` badge and its cost intact.
*Binds:* K13 soft-delete rule, `features/admin_cost.feature`.

**US-24 — Download the report as a PDF**
As a candidate, I want the report as a file, so that I can keep or share it.
→ "Download PDF" → rendered server-side in `worker` → signed URL, 5 min TTL.
*Binds:* K15, K12. *Note:* last bonus bucket (§12) — the first thing cut if the deadline
squeezes, and cutting it costs nothing mandatory.

---

## B. Admin stories

**US-25 — Admins sign in with a password only**
As an admin, I must be unable to sign in with Google, so that the privileged path has one
controlled entry.
→ Google callback and session creation both reject an admin account with
`ADMIN_MUST_USE_PASSWORD`; no session is created.
*Binds:* K8.4, `features/admin_auth.feature`. *Note:* brief-mandated negative requirement,
enforced twice on purpose.

**US-26 — See every interview and what it cost**
As an admin, I want a list of all interviews filterable by occupation, state and user, with
tokens and USD cost, so that I can see what the system is spending.
→ Deleted interviews still listed with a badge → open one → per-call rows including which
prompt version produced each question → voice usage appears as its own provider row
(`unit_kind = 'second'`) → total cost as one number at the top.
*Binds:* K13 (`llm_calls`), §3.5 reconciliation.

**US-27 — See statistics by occupation**
As an admin, I want charts of interview count per occupation cluster, average duration,
completed vs. unfinished, total tokens and total cost, so that I can judge how the product
is used.
→ Dashboards → filter to one cluster → which questions are most often answered weakly.
*Binds:* K11 metric definitions (they are fixed there precisely so two people don't produce
two numbers), K15 `report_questions`.

**US-28 — Trace a bad report**
As an admin, I want to follow one interview through the logs, so that I can find the prompt
version that produced a bad section and roll it back.
→ Copy `interviewId` → Kibana (or `docker compose logs api | grep <interviewId>`) → request
log, every prompt/completion, model, latency, cost, plus room events (join, round switch,
voice drop, fallback).
*Binds:* K6. *Note:* Kibana is profile-gated and may not be running at demo time — the same
trace must be answerable from `docker compose logs`.

**US-29 — See when the system defended itself**
As an admin, I want prompt-injection suspicions and budget/time trips surfaced in the panel,
so that security and cost events aren't buried in a log file.
→ `SECURITY_PROMPT_INJECTION_SUSPECTED`, `budget_exhausted`, `time_exhausted` visible per
interview.
*Binds:* §7.1, §7.3.

---

## C. Blocker resolutions (meeting, 2026-07-29)

| # | Raised as | Resolution | Where it lives |
|---|---|---|---|
| 1 | End the interview early when the candidate can't answer | **Adopted.** The interviewer takes the initiative and closes with `ended_reason = 'cut_short'`; the report says why. | US-14, K5 |
| 2 | A fixed question count makes no sense — each question opens another; time-based would be better | **Partly adopted.** The count stays, because the brief has the user choose it and exceeding it reads as a violated requirement. It is a **ceiling, not a quota**. The time dimension already exists as the voice ceiling (12 min/round, 25 min/interview) and as `ended_reason = 'time_exhausted'`. | US-06, US-14, K5, §7.3 |
| 3 | Should leaving and rejoining the meeting be possible? | **Yes.** Resume was already required by the refresh case; leaving is the same mechanism. 24 h idle → `abandoned`. | US-19, K2 |
| 4 | "Take initiative" — set a count but end when it makes sense | **Adopted as the rule for both.** The interviewer may shorten, never extend. | US-14, K5 |

---

## D. Rewritten against IDEA.md

Recorded so the changes don't look like accidents.

| Original story | Claim | Ruling |
|---|---|---|
| 1, 2 | Guest pastes a listing at `/dashboard?instant=1`, signs in later, listing preserved | **Cut.** No anonymous flow (K8). Sign-in precedes setup, so the preservation trick is unnecessary. |
| 1, 13 | The recording is saved and viewable | **Cut.** Transcript only; no audio or video is recorded (§3.2). |
| 3 | Lobby lets the user pick which rounds to run | **Cut.** Both rounds always run — a state-machine branch and a second report shape for no scored requirement. |
| 3 | Editable occupation summary | **Kept** (US-05). LLM extraction is fallible and `occupation` backs a scored filter. |
| 5, 6 | Idle/speaking video loops, multiple avatars per character | **Cut.** 5 static images per persona (§3.6). |
| 9 | A heartbeat agent extends or shortens the round | **Halved.** Shortening kept (US-14). Extension cut. |
| 12 | Report shows speaking pace and filler-word count | **Cut.** Both need raw audio or a disfluency-preserving ASR; we record no audio and ElevenLabs returns cleaned text (§2.1). Answer duration and STAR adherence stay. |
| 4 | Camera on by default | **Flipped.** Off by default (§14). |
| — | "No dashboard — show the setup screen instead" (reference UI direction, 2026-07-30) | **Halved.** First run routes to setup, so a new user never meets an empty dashboard (K8.7). The dashboard itself stays: interview history list/view/delete is a mandatory 5-point requirement (US-22, US-23). |
| — | `REC / LIVE` indicator in the room (reference UI direction) | **Halved.** `LIVE` stays; `REC` is **cut** and no consent screen exists — nothing is recorded (§3.2), and a recording badge on a product that records nothing is a claim a user would act on. |
| — | Setup-screen *Practice mode* and *template library* option cards | **Cut.** Every interview here is practice, so a "practice mode" toggle means nothing; the template library is reduced to one seeded sample listing (§4.3.1). |
| — | Setup-screen *Import job URL* | **Cut.** Server-side fetching of a user-supplied URL is an SSRF surface (internal services, cloud metadata) with no scored requirement behind it (§4.3.1). |

---

## E. Not in IDEA.md — needs a decision before it becomes a story

The candidate story list included a CV-driven track that `IDEA.md` does not cover at all.
Written down rather than silently dropped, but **not numbered**, because numbering implies
scope.

- Upload a CV to complete the profile.
- System detects standout skills from the CV and serves a 2-3 question skill test to verify
  them.
- Profile is enriched with both CV content and skill-test results.
- "Search jobs based on my CV" — automatic filtering of job listings against experience,
  skills and interests.
- Start an interview directly from a matched listing.

**Why this is a real scope question, not a small addition:** it needs a job-listing corpus
we don't have, a matching/search surface, CV parsing beyond `unpdf`, and a second profile
model. The existing profiling stage (US-07) already satisfies the brief's "pre-questions
personalise the generated questions" bonus with a 3-field lobby form. Recommendation: keep
the CV track out, or reduce it to **CV upload feeding `candidate_profile`** (one field, no
job board, no skill test) if the profiling bonus needs more weight.

**Resolved 2026-07-30 — the reduced option was taken, and slightly more.** CV upload is in scope as
**US-02c**: the PDF is uploaded through the existing `POST /uploads` path, **the file is retained**
in the private bucket (`uploads.kind = 'cv'`, `users.cv_upload_id`), and its extracted text feeds
question generation *and* report generation — the evaluation may compare a claim on the CV against
the answer given for it (K15). Still **cut**: the job board, CV↔listing matching, and the skill test.
Those need the corpus and the second profile model this section was written to flag.

---

## F. Still open

1. **Interview language confirmation** — auto-detect from the listing is assumed everywhere
   above and settled in §3.4; confirm the lobby override is enough.
2. **ElevenLabs agent provisioning** — console by hand or created via API at startup?
   Affects `.env`, seeding and `SETUP.md` (IDEA §15.1).
3. **ElevenLabs SDK audio surface** — determines whether the amplitude-driven avatar exists
   at all (IDEA §15.1). No story above depends on the answer.
