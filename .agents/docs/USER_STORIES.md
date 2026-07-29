# User Stories For Interviewly

Format: one flow per story, arrow-chained, from the user's point of view.
Sources: `Mock Interview Idea Document.docx` (body + inline comments), `IDEA.md`.

---

## 1. Instant interview (happy path, voice)

User enters a related keyword to find application -> User clicks on the Home Page link -> Lands on home page, sees Start Your Interview CTA Button -> Clicks Button -> User is redirected to `/dashboard?instant=1` -> directly sees the text area zone -> pastes job listing description -> waits several seconds to attend meeting (in that time we show "wait until the hosts accept your join request", and user can check his/hers mic and camera) -> Host allows to join (agent is loaded with Q's) -> User joins in, sees a HR Agent with camera on, a technical agent with camera off -> HR Agent serves a warm welcome, then asks first question -> user loops until the HR Agent's questions are done -> HR Agent closes their camera, technical agent flow starts. Same loop; when a non-talkable question comes, a UI interface is shown to the user to fill in -> interview ends, answers and report are saved -> user sees the recent interviews with reports and the recording.

## 2. Signing in and keeping the interview

Guest user finishes pasting the job listing on `/dashboard?instant=1` -> before the room opens, we ask to sign in (email/password or Google) -> user picks Google, one click, comes back to the same lobby with the pasted listing still there -> joins the interview -> at the end, the interview is attached to the account, not to a browser session -> user opens `/me/interviews` and sees it in the list.

## 3. Lobby setup with a PDF listing

User is signed in -> goes to Dashboard -> clicks "Set up interview" -> sees the lobby form: paste text **or** upload the listing PDF, pick a target question count, pick which rounds to run -> uploads a PDF -> we extract the text, detect the occupation from the listing and normalize it into an occupation cluster (`cluster.prompt.yaml`), and detect the listing language -> lobby shows "Backend Developer · Turkish · ~8 questions" as an editable summary -> user corrects the occupation if wrong -> clicks Join.

## 4. Mic & camera check before joining

User is in the waiting screen -> sees own camera preview and a mic level bar -> toggles camera off, mic stays on -> a note says the camera image never leaves the browser and nothing is recorded server-side -> both interviewers are already visible in the lobby, cameras on/off as they choose -> user clicks "Ready" -> host accepts -> room opens with the exact device state chosen in the lobby.

## 5. HR round with a real interviewer feel

User joins the room -> HR persona (name, voice, avatar all coming from the `personas` table, not hardcoded) greets by name and explains the format -> asks question 1, the progress dot bar shows `1 / 8` -> user answers out loud, live transcript appears on the right so the user sees what was understood -> after some answers the interviewer occasionally says "let me note that down, one second" / thinking beat before the next question -> the avatar switches between idle and speaking clips, and between multiple avatars for the same character depending on the conversation -> user cannot jump to question 3; the interviewer only moves on when the current answer is submitted.

## 6. Round handover

HR round's last answer is submitted -> screen shows "HR round completed, connecting you to the technical interviewer" interstitial -> HR persona's camera goes off -> technical persona's camera turns on and greets -> user sees the round marker change in the transcript panel -> technical questions start from the listing's technologies.

Note (from comment): "technical" is not the right word for every occupation. For non-engineering listings the second round is labelled a **competency / yeterlilik** round, and the questions are drawn from the occupation cluster instead of a tech stack.

## 7. Non-talkable question

Technical round is running -> a question comes that cannot be answered by speaking (write a SQL query / pick from options / order the steps) -> the interviewer says "I'm sending this one to your screen" -> a UI panel opens in the room: code box, multiple choice, or ordering widget -> mic is muted while the user works -> user submits -> panel closes, interviewer reacts to the submitted answer and continues -> the submitted content is stored as the answer for that question, same as a spoken one.

## 8. Adaptive difficulty

User gives a weak answer on "SQL indexes" -> next question stays on indexing but drops one difficulty level, and the interviewer frames it as a follow-up, not a repeat -> user answers strongly this time -> the following question moves up a level and to a new topic -> user never sees a difficulty label, only that the interview follows what they said.

## 9. Interview length adapts to the conversation

User picked "8 questions" in the lobby -> during the round a background `interview_heartbeat` agent watches the conversation -> user is giving deep, on-point answers -> the round is cut short and closed early with a positive note -> or, answers are thin and the topic is unresolved -> the round is extended with extra questions -> the progress indicator updates accordingly (target, not a fixed count) -> the report explains why the interview ran long or short.

## 10. Voice drops, interview survives

User is mid-answer in voice mode -> the voice connection dies (network, permission revoked, provider outage) -> the room shows "Voice connection lost, continuing in text" -> the same question stays on screen with a text box -> everything answered so far is intact -> user types the rest of the interview -> report is produced normally, and the report notes that part of the interview was in text mode.

## 11. Refresh / come back later

User is on question 4 of 8, closes the tab by accident -> reopens the app -> Dashboard shows the interview as "in progress — continue" -> user clicks it -> rejoins the room at question 4, previous answers still there, interviewer picks up where it left off -> if the user never comes back, the interview turns into `abandoned` and shows up in the "unfinished" statistic.

## 12. Report

Interview ends -> user sees a "preparing your evaluation" screen -> report page opens: overall impression, strengths, areas to improve, per-round evaluation, and a per-question score breakdown -> extra signals shown: answer duration, speaking pace, filler word count ("eee", "yani"), STAR structure fit -> user opens a question row and sees their own transcript next to the note about that answer -> clicks "Download PDF" -> gets the same report as a file.

Note (from comment): if the HR round goes badly, the user is **not** eliminated — they always continue to the second round, and the report carries a "HR round was weak" note instead.

## 13. Interview history

User opens `/me/interviews` -> sees past interviews with occupation, date, duration, state (completed / unfinished) and score -> filters by occupation -> opens one, sees the report and the recording/transcript -> deletes an old one -> it disappears from their list immediately -> the data stays on the admin side flagged as deleted (soft delete), it is not erased.

## 14. Admin — interviews and cost

Admin signs in -> sees the admin panel instead of the normal dashboard -> opens "All interviews" -> filters by occupation, state, user -> sees a deleted interview still listed with a "deleted" badge -> opens it, sees which prompt version produced each question, tokens spent, and cost in USD -> voice (STT/TTS) usage shows in the same cost list as a separate provider row -> total cost for the interview is one number at the top.

## 15. Admin — statistics

Admin opens Dashboards -> sees interview count per occupation, average duration, completed vs. abandoned ratio, total tokens and total cost -> narrows to one occupation cluster -> sees which questions are most often answered weakly -> uses it to decide which prompt version to roll back.

## 16. Admin — tracing a bad report

A user complains about a report -> admin opens the interview and copies its `traceId` -> opens Kibana -> sees, under that one trace, the request log, every prompt/completion, the model, the latency, and the cost of each call -> the same trace also carries the room's own events (join, round switch, voice drop, fallback to text) -> admin identifies the prompt version that produced the bad section and rolls it back.

---

## Open points that change these stories

- **Language**: interview runs in the listing's language automatically (story 3 assumes this). Confirm.
- **Camera**: assumed on-by-default but toggleable, never uploaded, never recorded.
- **Question types**: open-ended by default, non-talkable types only in the second round (story 7).
- **Avatar**: option B (idle/speaking video loops, multiple avatars per character) assumed in stories 5 and 6.
