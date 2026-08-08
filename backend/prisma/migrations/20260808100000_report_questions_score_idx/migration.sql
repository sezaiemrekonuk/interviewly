-- Issue 143: `/admin/stats` sorts `report_questions` by `ORDER BY score ASC, question_id ASC
-- LIMIT 5` on a table whose only indexes are the primary key and the (report_id, question_id)
-- unique — a full scan plus a sort on every request. Both sort columns, in order, so the
-- top 5 comes off the index.
CREATE INDEX "report_questions_score_question_id_idx" ON "report_questions" ("score", "question_id");
