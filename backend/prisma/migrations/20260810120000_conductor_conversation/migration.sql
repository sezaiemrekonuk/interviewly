-- C01 — the conversation becomes the interview's memory.
--
-- Until now `chat_messages` held one row per candidate answer and nothing else: no assistant
-- rows, no record of why the interview moved on. That was sound while `current_index` WAS the
-- state — a refreshed room reconstructed itself from a single integer (§3.8). It stops being
-- sound the moment an interviewer decides when to advance, because then the history is the
-- state, and a reload with no assistant rows replays a different interview than the one the
-- candidate sat through.
--
-- Every column here is nullable and every table keeps its old shape, so this migration is
-- readable by the code that predates it: an interview mid-flight when it lands keeps working
-- on the old path, with `question_id` and `action` simply unset on its rows.

-- The decision the conductor took at the end of a turn. `continue` is a value rather than the
-- absence of one — "stayed on this question deliberately" and "no decision was recorded" are
-- different facts, and only the first should be readable as a choice.
--
-- `drift` is the value the model cannot produce. The server writes it on the system row it
-- injects when the per-question ceiling is reached and the advance is forced, which is what
-- makes an overridden interviewer visible in the transcript rather than only in the logs.
CREATE TYPE "ConductorAction" AS ENUM (
  'continue',
  'next_question',
  'handover',
  'end_interview',
  'show_widget',
  'drift'
);

-- Which question an utterance belongs to. NULL is not "unknown" — it is "said outside a
-- question's window", which the welcome and the handover line genuinely are.
ALTER TABLE "chat_messages" ADD COLUMN "question_id" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN "action" "ConductorAction";

-- RESTRICT like every other foreign key in this schema (F02): deletion is soft or never.
ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_question_id_fkey"
  FOREIGN KEY ("question_id") REFERENCES "questions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The replay reads one interview's messages in `created_at` order on every single turn, and
-- the answer window reads them again filtered by question. Without this the conductor's cost
-- per turn includes a sequential scan that grows with the conversation it is having.
CREATE INDEX "chat_messages_interview_id_created_at_idx"
  ON "chat_messages" ("interview_id", "created_at");

-- C04 — the typed answer surface for a question, when it has one:
-- `{ "kind": "textbox" | "choice", "label": "…", "options": ["…"] }`.
--
-- The enum values `QuestionKind.widget` and `InputMode.widget` have existed since the init
-- migration with nothing to put in them; `state.ts` has been returning a hardcoded
-- `widget: null` next to a `ponytail:` note saying so. This is the column that note was
-- waiting for. JSONB rather than columns because the payload differs per kind and the set of
-- kinds is the frontend's business, not the table's.
ALTER TABLE "questions" ADD COLUMN "widget" JSONB;

-- C05 — what the slot is for, in the interviewer's words. The conductor writes the sentence
-- it actually asks from this; `questions.text` keeps the batch's own wording as the sentence
-- to fall back to when no conductor is available to write one (a provider outage mid-round).
--
-- Nullable with no backfill: every existing row's `text` is already a real question, which is
-- exactly the fallback behaviour a NULL intent selects.
ALTER TABLE "questions" ADD COLUMN "intent" TEXT;
