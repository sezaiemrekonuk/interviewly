-- S05 / ADR-S05. `voice_sessions` held a convai mint credential — (interview_id, nonce,
-- expires_at, consumed_at) — read only by the webhook gates ADR-S03 deleted. There is no mint
-- and no nonce under ADR-S01, and the ceiling now derives from `interviews.started_at`.
DROP TABLE IF EXISTS "voice_sessions";
