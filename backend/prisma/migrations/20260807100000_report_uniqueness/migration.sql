-- CreateIndex
CREATE UNIQUE INDEX "report_questions_report_id_question_id_key" ON "report_questions"("report_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_interview_id_key" ON "reports"("interview_id");
