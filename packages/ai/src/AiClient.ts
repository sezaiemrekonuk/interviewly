/**
 * The one seam. `api` and `worker` reach AI work through this interface and no other way —
 * no module outside this package imports a provider SDK (I02 keeps them internal).
 *
 * Every async method binds a per-attempt timeout, records one `llm_calls` row per attempt
 * and returns a value already validated against its Zod schema (I02). `detectLanguage` is
 * the odd one out on purpose: it is synchronous, makes no call, and records nothing.
 */
import type { AiCtx } from './prompt-builder';
import type { LanguageDetection } from './detect-language';
import type {
  Candidate,
  QuestionBatch,
  ReportPayload,
  RoundType,
  Scores,
} from './schemas';

export type { AiCtx } from './prompt-builder';

/** Per-attempt timeouts, ai spec B6/Q3. Enforced by I02, declared here with the seam. */
export const TIMEOUT_MS = {
  generateRoundQuestions: 15_000,
  scoreAnswer: 15_000,
  generateCandidates: 15_000,
  generateReport: 90_000,
} as const;

export interface GenerateRoundQuestionsArgs {
  roundType: RoundType;
  count: number;
  jobListing: string;
  candidateProfile: unknown | null;
  candidateCv: string | null;
  language: string;
  priorTopics?: string[];
  ctx: AiCtx;
}

export interface GenerateReportArgs {
  transcript: string;
  perAnswerScores?: Scores[];
  candidateProfile: unknown | null;
  candidateCv: string | null;
  language: string;
  ctx: AiCtx;
}

export interface ScoreAnswerArgs {
  question: string;
  transcript: string;
  candidateProfile: unknown | null;
  language: string;
  ctx: AiCtx;
}

export interface GenerateCandidatesArgs {
  priorQuestion: string;
  priorScore: number;
  topicsUsed: string[];
  language: string;
  ctx: AiCtx;
}

export interface AiClient {
  /**
   * One call produces a whole round. The returned batch is schema-valid but its LENGTH is
   * the caller's check: `questions.length === count` or `AI_OUTPUT_INVALID` (I04).
   */
  generateRoundQuestions(args: GenerateRoundQuestionsArgs): Promise<QuestionBatch>;
  generateReport(args: GenerateReportArgs): Promise<ReportPayload>;
  /** K4 hook consumed by the `adaptive` ledger; interface and stub ship in I01. */
  scoreAnswer(args: ScoreAnswerArgs): Promise<Scores>;
  /** K4 hook: easier / same / harder, in that order. */
  generateCandidates(args: GenerateCandidatesArgs): Promise<Candidate[]>;
  /** No LLM call, no `llm_calls` row, no network (ai AC-13). */
  detectLanguage(text: string, current: string): LanguageDetection;
}
