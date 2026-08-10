-- C07 — a refused action has to leave a mark, and the report has to know it happened.
--
-- Found by driving a real prompt injection through the room. The guard worked: the model was
-- talked into `end_interview` on the opening exchange and `clampAction` refused it. But the
-- refusal was silent, so the *only* thing written to the conversation was the interviewer's
-- farewell — and on the very next turn the model read its own goodbye back, repeated it, and by
-- then the opening-exchange guard no longer applied. The interview ended after one question with
-- `ended_reason = 'completed'`.
--
-- The guard bought exactly one turn and the silence handed it back. An override the overridden
-- party cannot see is not an override, it is a delay. `drift` already understood this — it
-- writes a system row saying the interviewer was moved on. Refusals need the same, and for the
-- same reason.

-- The server's own value, like `drift`: the model cannot produce it, and it marks the row that
-- tells the next turn what was taken away from it.
ALTER TYPE "ConductorAction" ADD VALUE 'refused';

-- Which candidate utterances matched a §7.1 injection pattern. The scan already ran on every
-- turn and only ever reached a log line, so the signal died in Kibana: the interview it happened
-- in could not see it, and neither could the report scoring the candidate who typed it.
--
-- Deliberately on the message and not on the interview. "This interview had an injection" is a
-- summary; "this sentence was the injection" is evidence, and the report is allowed to quote it.
ALTER TABLE "chat_messages"
  ADD COLUMN "flagged_injection" BOOLEAN NOT NULL DEFAULT false;
