-- Ensure one round per type for each interview.
CREATE UNIQUE INDEX "interview_rounds_interview_id_type_key"
ON "interview_rounds"("interview_id", "type");
