/**
 * The §5.5 layer-2 validators. Every `AiClient` method returns a value that has passed
 * through one of these or it throws — no raw provider text leaves this package.
 *
 * Field naming follows `.agents/specs/2026-07-29-ai.md`: the payload schemas are snake_case
 * because `ReportPayload` is stored verbatim in `reports.payload` and asserted key-by-key by
 * `schema_validation.feature`. The *call* interfaces (AiClient.ts) stay camelCase like the
 * rest of the TypeScript.
 */
import { z } from 'zod';

export const QuestionKindSchema = z.enum(['open', 'behavioral', 'technical', 'widget']);
export const DifficultySchema = z.enum(['easy', 'medium', 'hard']);
export const RoundTypeSchema = z.enum(['hr', 'tech']);

/** Integer 0..5 — every score in this package, without exception. */
const score = z.number().int().min(0).max(5);
/** 0..1 inclusive — STAR adherence. */
const ratio = z.number().min(0).max(1);

export const QuestionSchema = z.object({
  text: z.string().min(1),
  kind: QuestionKindSchema,
  difficulty: DifficultySchema,
  topic: z.string().min(1),
  orderIndex: z.number().int().positive(),
});

/**
 * The raw generation schema. It deliberately does NOT constrain `questions.length`: the
 * requested count is runtime data, so baking it in would stop one definition serving both
 * the HR batch (3) and the tech batch (5). The caller compares `questions.length === count`
 * and raises `AI_OUTPUT_INVALID` on a mismatch (question_generation.feature @AC-1).
 */
export const QuestionBatchSchema = z.object({
  questions: z.array(QuestionSchema),
});

/** K4 adaptive candidate: no `orderIndex`, because it is promoted into an existing row. */
export const CandidateSchema = z.object({
  text: z.string().min(1),
  difficulty: DifficultySchema,
  topic: z.string().min(1),
});

export const ScoresSchema = z.object({
  overall: score,
  relevance: score,
  depth: score,
  structure: score,
  star_adherence: ratio,
  reasons: z.array(z.string().min(1)).min(1).max(5),
});

export const ReportPayloadSchema = z.object({
  overall_impression: z.string().min(1),
  overall_score: score,
  strengths: z.array(z.string().min(1)).min(2).max(5),
  improvements: z.array(z.string().min(1)).min(2).max(5),
  rounds: z
    .array(
      z.object({
        type: RoundTypeSchema,
        score,
        summary: z.string().min(1),
        note: z.string().optional(),
      }),
    )
    .min(1),
  questions: z.array(
    z.object({
      question_id: z.string().min(1),
      score,
      reason: z.string().min(1),
      star_adherence: ratio,
    }),
  ),
  language: z.string().min(2),
});

export type QuestionKind = z.infer<typeof QuestionKindSchema>;
export type Difficulty = z.infer<typeof DifficultySchema>;
export type RoundType = z.infer<typeof RoundTypeSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionBatch = z.infer<typeof QuestionBatchSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type Scores = z.infer<typeof ScoresSchema>;
export type ReportPayload = z.infer<typeof ReportPayloadSchema>;
