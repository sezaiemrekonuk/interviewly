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

/**
 * The two languages an interview runs in (ai Q1). The same closed set `language.ts` guards its
 * switch with — a model naming a third one is a schema failure here rather than a `language`
 * column no prompt, no UI locale and no report renders.
 */
export const InterviewLanguageSchema = z.enum(['en', 'tr']);

/**
 * The score ceiling. Every score in this package is an integer 0..SCORE_MAX, without
 * exception — exported because the worker's PDF and the prompts' `0..100` wording are the
 * same fact, and a second literal is how a rescale half-lands (ADR-I39).
 */
export const SCORE_MAX = 100;

const score = z.number().int().min(0).max(SCORE_MAX);
/** 0..1 inclusive — STAR adherence. */
const ratio = z.number().min(0).max(1);

export const QuestionSchema = z.object({
  /**
   * The askable sentence. Since C05 this is the *fallback* wording rather than the script:
   * the conductor writes the question it really asks from `intent` and overwrites this. It
   * stays required, and stays a real question, because it is what an interview falls back to
   * when the conductor cannot be reached mid-round — an agenda with no sentences would leave
   * a provider outage with nothing to ask.
   */
  text: z.string().min(1),
  /**
   * C05 — what this slot is for, in the interviewer's own words. Optional so that v1/v2 of
   * the generation prompt (still on disk, still resolvable by version) keep validating.
   */
  intent: z.string().min(1).optional(),
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

export const CandidateBatchSchema = z.object({
  candidates: z.array(CandidateSchema),
});

export const INTERVIEW_TITLE_MAX = 80;

export const InterviewTitleSchema = z.object({
  title: z.string().trim().min(1).max(INTERVIEW_TITLE_MAX).refine((t) => !/[\r\n]/.test(t), { message: 'must be single line' }),
});

/**
 * ADR-ADD03 — the gate in front of interview setup. `is_job_listing` is what decides whether an
 * interview is built at all; `language` is the listing's own language and becomes the
 * interview's, which is what stops a Turkish listing being interviewed in English because the
 * account's locale happened to say so.
 */
export const ListingCheckSchema = z.object({
  is_job_listing: z.boolean(),
  language: InterviewLanguageSchema,
});

export const ScoresSchema = z.object({
  overall: score,
  relevance: score,
  depth: score,
  structure: score,
  star_adherence: ratio,
  reasons: z.array(z.string().min(1)).min(1).max(5),
});

/**
 * C04 — the answer surface the conductor can put on screen instead of asking for prose.
 * `options` is required by `choice` and meaningless to `textbox`; the refine below is what
 * stops a choice widget rendering as a list of nothing.
 */
export const WidgetSchema = z
  .object({
    kind: z.enum(['textbox', 'choice']),
    label: z.string().min(1).max(200),
    options: z.array(z.string().min(1).max(120)).min(2).max(6).optional(),
  })
  .refine((w) => w.kind !== 'choice' || (w.options?.length ?? 0) >= 2, {
    message: 'a choice widget needs at least two options',
  });

/**
 * C02 — one conductor turn. This is the whole tool-calling surface, expressed as JSON rather
 * than as provider-native tools: `providers.ts` speaks to both tiers through one hand-rolled
 * `fetch` each, and a native tool call would have to be implemented, validated and kept in
 * step twice. One schema through the layer-2 gate that already exists costs nothing new and
 * fails the same way everything else in this package fails.
 *
 * `say` is what the candidate hears or reads. `action` is what the server is being asked to
 * do about it — asked, not told: every value is re-checked against the interview's real state
 * in `conductor.ts` before anything is written, because this object is derived from candidate
 * text and is therefore untrusted input in the §7.1 sense.
 */
export const ConductorTurnSchema = z.object({
  say: z.string().min(1).max(1500),
  action: z.enum(['continue', 'next_question', 'handover', 'end_interview', 'show_widget']),
  /**
   * The question `say` actually put to the candidate, without the acknowledgement that
   * preceded it. Written to `questions.text` on `next_question` so the report quotes the
   * interview rather than the batch's planned wording. Ignored for every other action.
   */
  question: z.string().min(1).max(600).optional(),
  /** Required by `end_interview`, ignored otherwise. The server maps it to `EndedReason`. */
  endReason: z.enum(['completed', 'cut_short']).optional(),
  /** Required by `show_widget`, ignored otherwise. */
  widget: WidgetSchema.optional(),
  /**
   * `change_avatar` — an expression swap for the persona currently speaking, 1..3 (each of
   * Ada and Turing is seeded with exactly three). Orthogonal to `action`: it may ride on a
   * `continue` turn as easily as a `next_question` one, because an interviewer's expression
   * changes independently of the interview advancing. Silently ignored out of range — a wrong
   * expression is not worth a turn the way a bad `action` is.
   */
  avatar: z.number().int().min(1).max(3).optional(),
  /**
   * ADR-ADD03 — the interviewer moving the whole interview into the other language, asked for
   * by name rather than inferred from the text. Orthogonal to `action` like `avatar`: the
   * language can change on the turn a question advances as easily as on a clarification.
   * `conductor.ts` re-derives whether it is a real move, so a value equal to the language the
   * interview is already in costs nothing.
   */
  set_interview_language: InterviewLanguageSchema.optional(),
});

/**
 * T01 — the completeness gate's whole output. Strict on purpose: `{"finished":"maybe"}` is a
 * schema failure, which the live client turns into `finished: true` rather than a guess
 * (ADR-T03).
 */
export const TurnCompleteSchema = z.object({ finished: z.boolean() });

/**
 * The report artifact.
 *
 * `strengths`, `improvements` and `rounds` carry an upper bound and no lower one, and that
 * asymmetry is the point. The prompt asks for 2–5 of each and also forbids padding a thin
 * interview, so on a run that was stopped after one question the two instructions pull apart
 * and the model — correctly — returns fewer. A lower bound here turned that into
 * `AI_OUTPUT_INVALID` on every attempt, and the candidate got no report at all for the
 * interview they did sit: `cut_short` with one answered question failed both attempts and
 * landed on `failed`. A short report is the honest output; the absence of one is a defect.
 * The ceiling stays, because a model listing fifteen strengths is padding.
 */
export const ReportPayloadSchema = z.object({
  overall_impression: z.string().min(1),
  overall_score: score,
  strengths: z.array(z.string().min(1)).max(5),
  improvements: z.array(z.string().min(1)).max(5),
  rounds: z.array(
    z.object({
      type: RoundTypeSchema,
      score,
      summary: z.string().min(1),
      note: z.string().optional(),
    }),
  ),
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
export type InterviewLanguage = z.infer<typeof InterviewLanguageSchema>;
export type ListingCheck = z.infer<typeof ListingCheckSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionBatch = z.infer<typeof QuestionBatchSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type Widget = z.infer<typeof WidgetSchema>;
export type ConductorTurn = z.infer<typeof ConductorTurnSchema>;
export type TurnComplete = z.infer<typeof TurnCompleteSchema>;
export type Scores = z.infer<typeof ScoresSchema>;
export type InterviewTitle = z.infer<typeof InterviewTitleSchema>;
export type ReportPayload = z.infer<typeof ReportPayloadSchema>;
