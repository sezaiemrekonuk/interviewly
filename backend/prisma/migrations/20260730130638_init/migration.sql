-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "InterviewMode" AS ENUM ('voice', 'text');

-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('paste', 'upload');

-- CreateEnum
CREATE TYPE "InterviewState" AS ENUM ('created', 'profiling', 'hr_round', 'tech_round', 'paused', 'evaluating', 'completed', 'abandoned', 'failed');

-- CreateEnum
CREATE TYPE "EndedReason" AS ENUM ('completed', 'cut_short', 'budget_exhausted', 'time_exhausted', 'abandoned', 'error');

-- CreateEnum
CREATE TYPE "RoundType" AS ENUM ('hr', 'tech');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('pending', 'active', 'done');

-- CreateEnum
CREATE TYPE "QuestionKind" AS ENUM ('open', 'behavioral', 'technical', 'widget');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "InputMode" AS ENUM ('voice', 'text', 'widget');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('queued', 'generating', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "ChosenReason" AS ENUM ('score_low', 'score_mid', 'score_high', 'language_switch', 'fallback');

-- CreateEnum
CREATE TYPE "UnitKind" AS ENUM ('token', 'second', 'character');

-- CreateEnum
CREATE TYPE "AvatarState" AS ENUM ('idle', 'listening', 'thinking', 'speaking', 'acknowledging');

-- CreateEnum
CREATE TYPE "MascotPose" AS ENUM ('wave', 'point', 'think', 'cheer', 'shrug');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('user', 'assistant', 'system');

-- CreateEnum
CREATE TYPE "EmailTokenKind" AS ENUM ('verify', 'reset');

-- CreateEnum
CREATE TYPE "UploadKind" AS ENUM ('listing', 'cv');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email_lower" TEXT NOT NULL,
    "password_hash" TEXT,
    "google_sub" TEXT,
    "role" "Role" NOT NULL DEFAULT 'user',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "email_verified_at" TIMESTAMP(3),
    "profile" JSONB,
    "cv_upload_id" TEXT,
    "onboarding_completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "EmailTokenKind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personas" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "voice_id" TEXT NOT NULL,
    "avatar_set" JSONB NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occupation_clusters" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "occupation_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviews" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mode" "InterviewMode" NOT NULL,
    "job_text" TEXT NOT NULL,
    "job_source" "JobSource" NOT NULL,
    "upload_id" TEXT,
    "occupation" TEXT NOT NULL,
    "occupation_cluster_id" TEXT,
    "language" TEXT NOT NULL,
    "candidate_profile" JSONB,
    "target_question_count" INTEGER NOT NULL,
    "hr_question_count" INTEGER NOT NULL,
    "state" "InterviewState" NOT NULL DEFAULT 'created',
    "current_index" INTEGER NOT NULL DEFAULT 0,
    "ended_reason" "EndedReason",
    "budget_usd" DECIMAL(12,6) NOT NULL DEFAULT 0.50,
    "spent_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_rounds" (
    "id" TEXT NOT NULL,
    "interview_id" TEXT NOT NULL,
    "type" "RoundType" NOT NULL,
    "persona_id" TEXT NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'pending',
    "score" INTEGER,

    CONSTRAINT "interview_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "kind" "QuestionKind" NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "topic" TEXT NOT NULL,
    "candidates" JSONB,
    "chosen_reason" "ChosenReason",
    "asked_at" TIMESTAMP(3),

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "input_mode" "InputMode" NOT NULL,
    "started_at" TIMESTAMP(3),
    "answered_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "scores" JSONB,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "interview_id" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'queued',
    "payload" JSONB,
    "pdf_key" TEXT,
    "prompt_uuid" TEXT NOT NULL,
    "prompt_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_questions" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "star_adherence" DECIMAL(3,2) NOT NULL,

    CONSTRAINT "report_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_sessions" (
    "id" TEXT NOT NULL,
    "interview_id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "UploadKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "interview_id" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_calls" (
    "id" TEXT NOT NULL,
    "interview_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_uuid" TEXT NOT NULL,
    "prompt_version" INTEGER NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "fell_back_from" TEXT,
    "units" DECIMAL(12,3) NOT NULL,
    "unit_kind" "UnitKind" NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_usd" DECIMAL(12,6) NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "trace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_lower_key" ON "users"("email_lower");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_tokens_user_id_kind_idx" ON "email_tokens"("user_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "occupation_clusters_key_key" ON "occupation_clusters"("key");

-- CreateIndex
CREATE INDEX "interviews_user_id_created_at_idx" ON "interviews"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "interviews_occupation_cluster_id_idx" ON "interviews"("occupation_cluster_id");

-- CreateIndex
CREATE INDEX "interviews_state_idx" ON "interviews"("state");

-- CreateIndex
CREATE UNIQUE INDEX "questions_round_id_order_index_key" ON "questions"("round_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "uploads_sha256_key" ON "uploads"("sha256");

-- CreateIndex
CREATE INDEX "uploads_user_id_kind_idx" ON "uploads"("user_id", "kind");

-- CreateIndex
CREATE INDEX "llm_calls_interview_id_idx" ON "llm_calls"("interview_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_cv_upload_id_fkey" FOREIGN KEY ("cv_upload_id") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_occupation_cluster_id_fkey" FOREIGN KEY ("occupation_cluster_id") REFERENCES "occupation_clusters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_rounds" ADD CONSTRAINT "interview_rounds_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_rounds" ADD CONSTRAINT "interview_rounds_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "interview_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_questions" ADD CONSTRAINT "report_questions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_questions" ADD CONSTRAINT "report_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
